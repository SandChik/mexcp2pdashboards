const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

/**
 * BingX P2P OpenAPI client — the BingX counterpart of mexcApi.js.
 *
 * Everything in here was verified live with scripts/bingx-probe.js (Sep 2026):
 *   - Signature: parameters sorted by key (ASCII), joined as key=value&...,
 *     NOT URL-encoded, HMAC-SHA256 hex with the secret, appended as
 *     `signature` in the query string. Header `X-BX-APIKEY`.
 *   - Every endpoint needs a signature — including the ones the PDF marks
 *     "Verification Required: No" (they answer 100412 "Null signature").
 *   - orderNo / advertNo / uid arrive as raw 19-digit JSON numbers. JS only
 *     keeps 16 digits, so JSON.parse silently rounds them and every follow-up
 *     call says "order not existed". safeParse() quotes them before parsing.
 *   - `recvWindow` is accepted (the PDF examples misspell it `recWindow`).
 */

const BASE_URL = process.env.BINGX_BASE_URL || 'https://open-api.bingx.com'; // override only for local mock tests
const agent = new https.Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 3 });
const RECV_WINDOW = 5000; // BingX documents 5000 as the maximum; measured drift is well under 1s

// How POST parameters are sent. Learned the hard way with bingx-probe
// --post-noop (8 Sep 2026) and confirmed by BingX's own authentication guide
// (github.com/BingX-API/api-ai-skills, "JSON Request Body"):
//   json  : ALL parameters — business fields, recvWindow, timestamp AND the
//           signature — go INSIDE the JSON body; no query string at all.
//           The signing string is still every field ASCII-sorted (minus signature).
//   query : everything in the query string, empty body (BingX spot/swap style;
//           P2P answered "miss arguments").
//   form  : application/x-www-form-urlencoded body (P2P answered 100500).
// Kept switchable in case a future P2P endpoint behaves differently.
const POST_MODE = process.env.BINGX_POST_MODE || 'json';

// ── Rate gate, PER MERCHANT ─────────────────────────────────────────
// BingX limits are per UID (2/s on ad & payment-method endpoints, 5/s on
// order & chat). One conservative gate per API key at ~2 req/s keeps every
// endpoint under its limit, and a merchant's traffic never delays another's.
// Same priority-lane idea as mexcApi: clicks jump ahead of pollers.
const MIN_INTERVAL_MS = 520;
const gates = new Map(); // apiKey -> { lastAt, highQ, lowQ, draining }

function gateFor(key) {
  let g = gates.get(key);
  if (!g) { g = { lastAt: 0, highQ: [], lowQ: [], draining: false }; gates.set(key, g); }
  return g;
}
function gate(key, priority) {
  const g = gateFor(key);
  return new Promise(resolve => { (priority ? g.highQ : g.lowQ).push(resolve); drain(g); });
}
async function drain(g) {
  if (g.draining) return;
  g.draining = true;
  while (g.highQ.length || g.lowQ.length) {
    const wait = Math.max(0, g.lastAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    g.lastAt = Date.now();
    (g.highQ.length ? g.highQ.shift() : g.lowQ.shift())();
  }
  g.draining = false;
}

// ── Signing ─────────────────────────────────────────────────────────
function clean(params) {
  const out = {};
  Object.keys(params || {}).forEach(k => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });
  return out;
}
/** Canonical string: sorted keys, raw values (no encoding). Signed AND sent as-is. */
function canon(params) {
  const p = clean(params);
  return Object.keys(p).sort().map(k => `${k}=${p[k]}`).join('&');
}
function sign(str, apiSecret) {
  return crypto.createHmac('sha256', apiSecret).update(str).digest('hex');
}

// ── Big-integer-safe JSON ───────────────────────────────────────────
/** Quote every ≥16-digit integer literal that stands as a VALUE before parsing.
 *  13-digit timestamps are untouched. */
function safeParse(text) {
  if (typeof text !== 'string') return text;
  const guarded = text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
  return JSON.parse(guarded);
}

const axiosOpts = {
  httpsAgent: agent,
  timeout: 15000,
  transformResponse: [data => { try { return safeParse(data); } catch { return data; } }],
};

/**
 * GET. opts.priority = true for user-initiated calls only (see mexcApi).
 * Returns the parsed body `{ code, msg, timestamp, data }`.
 */
async function bingxGet(path, params, apiKey, apiSecret, opts = {}) {
  const q = canon({ ...params, recvWindow: RECV_WINDOW, timestamp: Date.now() });
  const url = `${BASE_URL}${path}?${q}&signature=${sign(q, apiSecret)}`;
  await gate(apiKey, !!opts.priority);
  const r = await axios.get(url, { ...axiosOpts, headers: { 'X-BX-APIKEY': apiKey } });
  return r.data;
}

/** POST. Parameter placement follows POST_MODE; the signature always covers all of them. */
async function bingxPost(path, params, apiKey, apiSecret, opts = {}) {
  const ts = Date.now();
  const all = { ...clean(params), recvWindow: RECV_WINDOW, timestamp: ts };
  const c = canon(all);
  const sig = sign(c, apiSecret);
  const headers = { 'X-BX-APIKEY': apiKey };
  let url, body;
  const mode = opts.postMode || POST_MODE;
  if (mode === 'json') {
    url = `${BASE_URL}${path}`;
    body = { ...all, signature: sig }; // timestamp + signature travel INSIDE the JSON
    headers['Content-Type'] = 'application/json';
  } else if (mode === 'form') {
    url = `${BASE_URL}${path}`;
    body = `${c}&signature=${sig}`;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    url = `${BASE_URL}${path}?${c}&signature=${sig}`;
    body = null;
  }
  await gate(apiKey, !!opts.priority);
  const r = await axios.post(url, body, { ...axiosOpts, headers });
  return r.data;
}

/** Endpoint paths — the ones that actually exist (the PDF lists two variants for several). */
const P = {
  ADVERT_LIST:        '/openApi/p2p/v1/advert/list',
  TOP_ADVERTS:        '/openApi/p2p/v1/advert/getTopAdverts',
  ASSET_CONFIG:       '/openApi/p2p/v1/common/assetConfig',
  PAYMENT_METHODS:    '/openApi/p2p/v1/paymentMethod/list',
  MY_PAYMENT_METHODS: '/openApi/p2p/v1/userPaymentMethod/list',
  MY_ADVERTS:         '/openApi/p2p/v1/merchant/myAdvert',
  ADVERT_ADD:         '/openApi/p2p/v1/merchant/advert/add',
  ADVERT_MODIFY:      '/openApi/p2p/v1/merchant/advert/modify',
  ADVERT_STATUS:      '/openApi/p2p/v1/merchant/advert/modifyStatus',
  ADVERT_PRICE:       '/openApi/p2p/v1/merchant/advert/modifyPrice',
  ORDER_LIST:         '/openApi/p2p/v1/merchant/order/list',
  ORDER_DETAIL:       '/openApi/p2p/v1/order/detail',
  ORDER_STATUS:       '/openApi/p2p/v1/merchant/order/modifyStatus',
  COUNTERPARTY:       '/openApi/p2p/v1/order/counterparty/info',
  IM_SEND:            '/openApi/p2p/v1/im/sendMsg',
  IM_LIST:            '/openApi/p2p/v1/im/group/msgList',
  FILE_UPLOAD_URL:    '/openApi/p2p/v1/file/uploadUrl',
};

module.exports = { bingxGet, bingxPost, safeParse, canon, P, POST_MODE };

const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

/**
 * Gate.io APIv4 client — the Gate counterpart of mexcApi.js / bingxApi.js.
 *
 * From the official APIv4 reference (gate-api-v4-markdown, v4.106.149):
 *   - Host https://api.gateio.ws, prefix /api/v4. Every P2P merchant endpoint
 *     is POST with a JSON body (since v4.106 they use the standard KEY/SIGN
 *     signing flow — no separate anonymous entry points any more).
 *   - Headers: KEY (api key), Timestamp (unix SECONDS, drift ≤ 60s), SIGN =
 *     HexEncode(HMAC_SHA512(secret, signature_string)) with
 *       signature_string = METHOD \n /api/v4/<path> \n <query string> \n
 *                          HexEncode(SHA512(body)) \n Timestamp
 *     Query string is sent and signed as-is (no URL encoding); empty body →
 *     SHA512 of the empty string.
 *   - Success: HTTP 2xx + { code: 0, message, data }. Failure inside a 2xx
 *     reply is { code: <non-zero>, message }; an HTTP 4xx/5xx carries
 *     { label, message } (e.g. 401 INVALID_KEY / INVALID_SIGNATURE).
 *   - Error field is `message` (BingX/MEXC call it `msg`); okData() below
 *     normalises so routes can keep their existing `.msg` handling.
 */

const BASE_URL = process.env.GATE_BASE_URL || 'https://api.gateio.ws'; // override only for local mock tests
const PREFIX = '/api/v4';
const agent = new https.Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 3 });

// ── Rate gate, PER MERCHANT ─────────────────────────────────────────
// The reference gives no explicit limit for the P2P merchant group; the
// per-UID private groups documented nearby allow 80r/10s. One gate per API
// key at ~4 req/s keeps well under that, and a merchant's traffic never
// delays another's. Same priority-lane idea as mexcApi: clicks jump ahead
// of pollers.
const MIN_INTERVAL_MS = 260;
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
function sha512Hex(s) { return crypto.createHash('sha512').update(s, 'utf8').digest('hex'); }
function signHeaders(method, fullPath, queryString, bodyString, apiKey, apiSecret) {
  const ts = String(Math.floor(Date.now() / 1000));
  const str = `${method.toUpperCase()}\n${fullPath}\n${queryString || ''}\n${sha512Hex(bodyString || '')}\n${ts}`;
  const sign = crypto.createHmac('sha512', apiSecret).update(str, 'utf8').digest('hex');
  return { KEY: apiKey, Timestamp: ts, SIGN: sign };
}

/** Drop undefined/null/'' so an optional field is simply not sent. */
function clean(params) {
  const out = {};
  Object.keys(params || {}).forEach(k => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });
  return out;
}
function queryOf(params) {
  const p = clean(params);
  return Object.keys(p).map(k => `${k}=${p[k]}`).join('&');
}

// ── Big-integer-safe JSON ───────────────────────────────────────────
// Gate ids seen in the reference are ≤ 10 digits, but orderid/txid are
// declared int64 — guard every ≥16-digit literal exactly like bingxApi does.
function safeParse(text) {
  if (typeof text !== 'string') return text;
  const guarded = text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
  return JSON.parse(guarded);
}

const axiosOpts = {
  httpsAgent: agent,
  timeout: 15000,
  validateStatus: () => true, // 4xx carries { label, message } — surface it, don't throw blind
  transformResponse: [data => { try { return safeParse(data); } catch { return data; } }],
};

/** Normalise an HTTP-level failure into the { code, message } envelope. */
function envelope(r) {
  const d = r.data;
  if (r.status >= 200 && r.status < 300) {
    if (d && typeof d === 'object') return d;
    return { code: -1, message: `Gate: jawaban bukan JSON (HTTP ${r.status})`, data: null };
  }
  const label = d && typeof d === 'object' ? d.label : null;
  const message = d && typeof d === 'object' ? (d.message || d.msg) : String(d || '').slice(0, 200);
  return { code: r.status, label, message: `${label ? label + ': ' : ''}${message || 'HTTP ' + r.status}`, data: null, http: r.status };
}

/**
 * GET. opts.priority = true for user-initiated calls only (see mexcApi).
 * Returns the parsed envelope. Spot endpoints (e.g. /spot/accounts) answer
 * with a bare array — those are wrapped as { code: 0, data } for uniformity.
 */
async function gateGet(path, params, apiKey, apiSecret, opts = {}) {
  const fullPath = PREFIX + path;
  const q = queryOf(params);
  const headers = { Accept: 'application/json', ...signHeaders('GET', fullPath, q, '', apiKey, apiSecret) };
  await gate(apiKey, !!opts.priority);
  const r = await axios.get(`${BASE_URL}${fullPath}${q ? '?' + q : ''}`, { ...axiosOpts, headers });
  const env = envelope(r);
  if (Array.isArray(env)) return { code: 0, data: env };
  if (env && env.code === undefined && !env.http) return { code: 0, data: env };
  return env;
}

/** POST with a JSON body (every P2P merchant endpoint). */
async function gatePost(path, body, apiKey, apiSecret, opts = {}) {
  const fullPath = PREFIX + path;
  const bodyString = JSON.stringify(clean(body));
  const headers = {
    Accept: 'application/json', 'Content-Type': 'application/json',
    ...signHeaders('POST', fullPath, '', bodyString, apiKey, apiSecret),
  };
  await gate(apiKey, !!opts.priority);
  const r = await axios.post(`${BASE_URL}${fullPath}`, bodyString, { ...axiosOpts, headers });
  return envelope(r);
}

/** Throw on a non-zero code; the error carries `.gate` = the envelope. */
function okData(res) {
  if (!res || res.code !== 0) {
    const e = new Error(`Gate ${res?.code ?? '?'}: ${res?.message || res?.msg || 'unknown error'}`);
    e.gate = { ...res, msg: res?.message || res?.msg };
    throw e;
  }
  return res.data;
}

/** Endpoint paths — exactly as listed under "P2p" in the APIv4 reference. */
const P = {
  USER_INFO:        '/p2p/merchant/account/get_user_info',
  COUNTERPARTY:     '/p2p/merchant/account/get_counterparty_user_info',
  MY_PAYMENTS:      '/p2p/merchant/account/get_myself_payment',
  WORK_HOURS:       '/p2p/merchant/account/set_merchant_work_hours',
  PENDING_ORDERS:   '/p2p/merchant/transaction/get_pending_transaction_list',
  COMPLETED_ORDERS: '/p2p/merchant/transaction/get_completed_transaction_list',
  ORDER_DETAIL:     '/p2p/merchant/transaction/get_transaction_details',
  CONFIRM_PAYMENT:  '/p2p/merchant/transaction/confirm-payment',
  CONFIRM_RECEIPT:  '/p2p/merchant/transaction/confirm-receipt',
  CANCEL_ORDER:     '/p2p/merchant/transaction/cancel',
  AD_SAVE:          '/p2p/merchant/books/place_biz_push_order',
  AD_STATUS:        '/p2p/merchant/books/ads_update_status',
  AD_DETAIL:        '/p2p/merchant/books/ads_detail',
  MY_ADS:           '/p2p/merchant/books/my_ads_list',
  MARKET_ADS:       '/p2p/merchant/books/ads_list',
  CHAT_LIST:        '/p2p/merchant/chat/get_chats_list',
  CHAT_SEND:        '/p2p/merchant/chat/send_chat_message',
  CHAT_UPLOAD:      '/p2p/merchant/chat/upload_chat_file',
  // The reference points P2P merchants at the Spot API for balances.
  SPOT_ACCOUNTS:    '/spot/accounts',
};

module.exports = { gateGet, gatePost, okData, safeParse, signHeaders, P, BASE_URL, PREFIX };

const axios = require('axios');
const https = require('https');
const { buildSignedParams } = require('./signature');

const BASE_URL = process.env.MEXC_BASE_URL || 'https://api.mexc.com'; // override only for local mock tests

// Keep-alive: reuse TCP+TLS connections to MEXC instead of paying a full
// handshake (~1-2 RTT) on every one of the hundreds of calls per minute.
const agent = new https.Agent({ keepAlive: true, maxSockets: 10, maxFreeSockets: 5 });

// ── Global rate limiter with a PRIORITY lane ────────────────────────
// MEXC allows ~10 req/s; we pace everything to ~7.7 req/s. The problem the
// lane solves: background polling (order lists, name resolution, capture
// worker) can keep the gate saturated for seconds at a time, and without a
// lane a click on Release/Detail waits at the BACK of that queue — which is
// exactly the "everything feels slow" symptom. Interactive calls now go to
// the front; pollers keep the leftovers.
const MIN_INTERVAL_MS = 130;
let lastAt = 0;
let draining = false;
const highQ = [];   // interactive: detail on click, release, confirm, ads, chat
const lowQ = [];    // polling, reports, capture, name resolution

function gate(priority) {
  return new Promise(resolve => {
    (priority ? highQ : lowQ).push(resolve);
    drain();
  });
}

async function drain() {
  if (draining) return;
  draining = true;
  while (highQ.length || lowQ.length) {
    const wait = Math.max(0, lastAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
    const next = highQ.length ? highQ.shift() : lowQ.shift();
    next();
  }
  draining = false;
}

// opts.priority — pass true for user-initiated calls only. Everything that
// runs on a timer must stay low priority or the lane stops meaning anything.
//
// Sign AFTER the gate, never before (v80). The timestamp goes stale while the
// request waits its turn: with three merchants polling, the low lane can hold
// 40+ calls (≈5 s at 130 ms each) and MEXC's default recvWindow is 5 s — that
// was the daily "Timestamp for this request is outside of the recvWindow".
async function mexcGet(endpoint, params = {}, apiKey, apiSecret, opts = {}) {
  await gate(!!opts.priority);
  const { queryString, signature } = buildSignedParams(params, apiSecret);
  const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
  const response = await axios.get(url, { headers: { 'x-mexc-apikey': apiKey }, httpsAgent: agent });
  return response.data;
}

async function mexcPost(endpoint, params = {}, apiKey, apiSecret, opts = {}) {
  await gate(!!opts.priority);
  const { queryString, signature } = buildSignedParams(params, apiSecret);
  const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
  const response = await axios.post(url, null, {
    headers: { 'x-mexc-apikey': apiKey, 'Content-Type': 'application/json' },
    httpsAgent: agent,
  });
  return response.data;
}

module.exports = { mexcGet, mexcPost };

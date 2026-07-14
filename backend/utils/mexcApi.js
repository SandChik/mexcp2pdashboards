const axios = require('axios');
const { buildSignedParams } = require('./signature');

const BASE_URL = 'https://api.mexc.com';

// ── Global rate limiter ──────────────────────────────────────────────
// MEXC allows ~10 req/s. We serialize ALL outgoing calls with a minimum
// spacing so 3 merchants × auto-refresh can never burst past the limit.
const MIN_INTERVAL_MS = 130; // ~7.7 req/s, safe margin under 10
let gateChain = Promise.resolve();
let lastAt = 0;
function gate() {
  gateChain = gateChain.then(async () => {
    const wait = Math.max(0, lastAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
  });
  return gateChain;
}

async function mexcGet(endpoint, params = {}, apiKey, apiSecret) {
  const { queryString, signature } = buildSignedParams(params, apiSecret);
  const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
  await gate();
  const response = await axios.get(url, { headers: { 'x-mexc-apikey': apiKey } });
  return response.data;
}

async function mexcPost(endpoint, params = {}, apiKey, apiSecret) {
  const { queryString, signature } = buildSignedParams(params, apiSecret);
  const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
  await gate();
  const response = await axios.post(url, null, {
    headers: { 'x-mexc-apikey': apiKey, 'Content-Type': 'application/json' },
  });
  return response.data;
}

module.exports = { mexcGet, mexcPost };

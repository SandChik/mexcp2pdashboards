const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/authMiddleware');
const { mexcGet, mexcPost } = require('../utils/mexcApi');

const { getMerchant } = require('../utils/store');
const { audit } = require('../utils/audit');
const { captureFtdByOrderNos } = require('../utils/captureCore');
const router = express.Router();

const UU_CACHE = path.join(__dirname, '../data/uu-cache.json');
function readUuCache() { try { return JSON.parse(fs.readFileSync(UU_CACHE, 'utf8')); } catch { return {}; } }
const FTD_PATH = path.join(__dirname, '../data/ftd-stats.json');
function readFtd() { try { return JSON.parse(fs.readFileSync(FTD_PATH, 'utf8')); } catch { return {}; } }
function writeUuCache(o) { try { fs.writeFileSync(UU_CACHE, JSON.stringify(o)); } catch {} }

// Normalize order state to a number (detail endpoint may return string enums)
function normState(s) {
  if (s === null || s === undefined) return -1;
  if (typeof s === 'number') return s;
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  const map = { NOT_PAID:0, PAID:1, WAIT_PROCESS:2, PROCESSING:3, DONE:4, CANCEL:5, CANCELLED:5, INVALID:6, REFUSE:7, TIMEOUT:8 };
  return map[String(s).toUpperCase()] ?? -1;
}
const TERMINAL = new Set([4, 5, 6, 7, 8]); // done/cancel/invalid/refuse/timeout

// Single window fetch — MEXC max 20 pages × 10 = 200 per window
async function fetchWindow(endpoint, params, apiKey, apiSecret, maxPages = 20) {
  let all = [];
  for (let page = 1; page <= maxPages; page++) {
    let res;
    try { res = await mexcGet(endpoint, { ...params, page, limit: 10 }, apiKey, apiSecret); }
    catch (e) { console.error('[fetchWindow] err:', e.response?.data || e.message); break; }
    if (res.code !== 0) { console.error('[fetchWindow] MEXC:', res.code, res.msg); break; }
    const items = Array.isArray(res.data) ? res.data : [];
    if (items.length === 0) break;
    all = [...all, ...items];
    if (page >= (res.page?.totalPage || 1)) break;
  }
  return all;
}

// Chunked fetch — splits range into daily windows to bypass 200 limit
// Max 7 days = 7 windows = up to 1400 orders
async function fetchChunked(endpoint, baseParams, apiKey, apiSecret, startTime, endTime) {
  const DAY = 86400000;
  const seen = new Set();
  let all = [];
  let t = parseInt(startTime);
  const end = parseInt(endTime);
  let chunk = 0;

  while (t < end && all.length < 1500) {
    const windowEnd = Math.min(t + DAY, end);
    chunk++;
    const items = await fetchWindow(endpoint,
      { ...baseParams, startTime: t, endTime: windowEnd },
      apiKey, apiSecret);

    for (const o of items) {
      if (!seen.has(o.advOrderNo)) { seen.add(o.advOrderNo); all.push(o); }
    }
    console.log(`[chunk ${chunk}] ${new Date(t).toLocaleDateString()} → ${items.length} orders, total=${all.length}`);
    t = windowEnd;
    if (t < end) await new Promise(r => setTimeout(r, 150));
  }
  return all;
}

// Micro-cache for QUICK list fetches (TTL 3s) with in-flight coalescing.
// Why: a phone and a laptop each poll every 5s, and the Antrian poller asks
// for the same list again — without this the server forwards every one of
// them to MEXC. With it, concurrent identical requests share ONE upstream
// call and anything within 3s is served from memory. 3s is well under the
// 5s poll interval, so freshness is unaffected.
const quickCache = new Map(); // merchantId|endpoint -> { at, promise }
const QUICK_TTL_MS = 3000;

function getOrdersCached(endpoint, params, merchant, isQuick) {
  if (!isQuick) return getOrders(endpoint, params, merchant.apiKey, merchant.apiSecret, false);
  const key = `${merchant.id}|${endpoint}`;
  const hit = quickCache.get(key);
  if (hit && Date.now() - hit.at < QUICK_TTL_MS) return hit.promise;
  const promise = getOrders(endpoint, params, merchant.apiKey, merchant.apiSecret, true)
    .catch(err => { quickCache.delete(key); throw err; }); // never cache failures
  quickCache.set(key, { at: Date.now(), promise });
  return promise;
}

async function getOrders(endpoint, params, apiKey, apiSecret, isQuick) {
  const now = Date.now();
  const DAY = 86400000;

  if (isQuick) {
    // Quick: last 24h, NEWEST FIRST, capped at 8 pages (80 orders). During a
    // busy event an uncapped 24h window can hit 16+ pages per merchant every
    // 5s across 3 merchants — more than the global rate gate can serve, so
    // the queue backs up and EVERYTHING gets slow. Older rows are carried
    // over by the client-side merge; active orders are always the newest.
    return fetchWindow(endpoint,
      { ...params, startTime: now - DAY, endTime: now },
      apiKey, apiSecret, 8);
  } else {
    const start = parseInt(params.startTime || now - 7 * DAY);
    const end = parseInt(params.endTime || now);
    const range = end - start;
    if (range <= DAY) {
      return fetchWindow(endpoint, { ...params, startTime: start, endTime: end }, apiKey, apiSecret);
    } else {
      return fetchChunked(endpoint, params, apiKey, apiSecret, start, end);
    }
  }
}

// GET /api/orders/:merchantId/market
router.get('/:merchantId/market', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  try {
    const { side, orderDealState, startTime, endTime, quick } = req.query;
    const baseParams = { ...(side && { side }), ...(orderDealState && { orderDealState }) };
    const params = { ...baseParams, startTime, endTime };
    const data = await getOrdersCached('/api/v3/fiat/market/order/pagination',
      params, merchant, quick === 'true');
    res.json({ code: 0, data, total: data.length });
  } catch (err) {
    console.error('[orders/market]', err.message);
    res.status(500).json({ code: -1, error: err.message });
  }
});

router.get('/:merchantId', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  try {
    const { side, orderDealState, startTime, endTime, quick } = req.query;
    const params = { ...(side && { side }), ...(orderDealState && { orderDealState }), startTime, endTime };
    const data = await getOrdersCached('/api/v3/fiat/merchant/order/pagination',
      params, merchant, quick === 'true');
    res.json({ code: 0, data, total: data.length });
  } catch (err) { res.status(500).json({ code: -1, error: err.message }); }
});

router.get('/:merchantId/detail/:advOrderNo', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Not found' });
  try {
    const r = await mexcGet('/api/v3/fiat/order/detail',
      { advOrderNo: req.params.advOrderNo }, merchant.apiKey, merchant.apiSecret, { priority: true });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:merchantId/confirm-paid', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Not found' });
  try {
    const r = await mexcPost('/api/v3/fiat/confirm_paid',
      { advOrderNo: req.body.advOrderNo, userConfirmPaymentId: req.body.userConfirmPaymentId },
      merchant.apiKey, merchant.apiSecret, { priority: true });
    audit({ action: 'confirm_paid', merchantId: merchant.id, merchantName: merchant.name, advOrderNo: req.body.advOrderNo, code: r?.code, msg: r?.msg });
    res.json(r);
  } catch (err) {
    const d = err.response?.data;
    res.status(500).json({ code: d?.code || -1, msg: d?.msg || err.message });
  }
});

router.post('/:merchantId/release-coin', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Not found' });
  const { advOrderNo } = req.body;
  if (!advOrderNo) return res.status(400).json({ code: -1, msg: 'advOrderNo required' });
  try {
    // Safety guard: releasing crypto is irreversible. Block only states that are
    // clearly terminal (already done / cancelled / etc). Anything else — including
    // states we can't parse — is allowed through; MEXC remains the final authority.
    // (Earlier this over-blocked PAID orders returned as strings → false 409.)
    let blocked = null;
    try {
      const detail = await mexcGet('/api/v3/fiat/order/detail', { advOrderNo }, merchant.apiKey, merchant.apiSecret, { priority: true });
      const st = normState(detail?.data?.state);
      if (TERMINAL.has(st)) {
        const names = { 4: 'already completed', 5: 'cancelled', 6: 'invalid', 7: 'refused', 8: 'timed out' };
        blocked = names[st] || ('in state ' + st);
      }
    } catch { /* detail lookup failed — don't block on that, let release proceed */ }

    if (blocked) {
      audit({ action: 'release_coin_blocked', merchantId: merchant.id, merchantName: merchant.name, advOrderNo, reason: blocked });
      return res.status(409).json({ code: -1, msg: `Can't release: order is ${blocked}.` });
    }

    const r = await mexcPost('/api/v3/fiat/release_coin', { advOrderNo }, merchant.apiKey, merchant.apiSecret, { priority: true });
    audit({ action: 'release_coin', merchantId: merchant.id, merchantName: merchant.name, advOrderNo, code: r?.code, msg: r?.msg });
    res.json(r);
  } catch (err) {
    const d = err.response?.data;
    audit({ action: 'release_coin_error', merchantId: merchant.id, merchantName: merchant.name, advOrderNo, msg: d?.msg || err.message });
    res.status(500).json({ code: d?.code || -1, msg: d?.msg || err.message });
  }
});

router.post('/:merchantId/create', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Not found' });
  try {
    const r = await mexcPost('/api/v3/fiat/merchant/order/deal', req.body, merchant.apiKey, merchant.apiSecret, { priority: true });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/orders/:merchantId/member-ids — resolve stable UID (memberId) per
// order via order detail. Cached so re-runs are cheap. Used by the UU report.
router.post('/:merchantId/member-ids', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Not found' });
  const advOrderNos = Array.isArray(req.body.advOrderNos) ? req.body.advOrderNos : [];
  const cache = readUuCache();
  const map = {};
  let fetched = 0, fromCache = 0, capped = false;
  const MAX_FETCH = 600; // bound per-call work; cache makes later calls instant
  for (const no of advOrderNos) {
    if (cache[no] && cache[no].registryTime !== undefined) { map[no] = cache[no]; fromCache++; continue; }
    if (fetched >= MAX_FETCH) { capped = true; continue; }
    try {
      const d = await mexcGet('/api/v3/fiat/order/detail', { advOrderNo: no }, merchant.apiKey, merchant.apiSecret);
      const u = (d && d.data && d.data.userInfo) || {};
      const rec = { memberId: u.memberId || u.imId || null, nickName: u.nickName || null, realName: u.realName || null, registryTime: u.registryTime || null };
      map[no] = rec; cache[no] = rec; fetched++;
    } catch { /* skip unresolved */ }
  }
  writeUuCache(cache);
  res.json({ map, fetched, fromCache, capped, max: MAX_FETCH });
});

// POST capture-stats — snapshot buyer trade stats for IN-PROGRESS orders, because
// MEXC strips userFiatStatistics/spotCount once an order is DONE. Shared logic
// with the 24/7 worker lives in utils/captureCore (single writer, locked).
router.post('/:merchantId/capture-stats', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Not found' });
  const nos = Array.isArray(req.body.advOrderNos) ? req.body.advOrderNos : [];
  const { captured } = await captureFtdByOrderNos(merchant, nos);
  res.json({ captured });
});

// GET ftd-stats — return captured snapshots for this merchant
router.get('/:merchantId/ftd-stats', authMiddleware, (req, res) => {
  const all = readFtd();
  const out = {};
  for (const [no, rec] of Object.entries(all)) if (rec.merchantId === req.params.merchantId) out[no] = rec;
  res.json({ snapshots: out });
});

module.exports = router;

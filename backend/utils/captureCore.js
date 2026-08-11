const fs = require('fs');
const path = require('path');
const { mexcGet } = require('./mexcApi');

/**
 * Capture core — ONE implementation of FTD-stat snapshotting and buyer-log
 * recording, shared by the HTTP routes (browser-triggered) and the 24/7
 * background worker. Both writers go through the same in-process lock, so a
 * route call and a worker tick can never interleave a read-modify-write and
 * silently drop each other's records.
 */

const DATA = path.join(__dirname, '../data');
const FTD_PATH   = path.join(DATA, 'ftd-stats.json');   // { [advOrderNo]: snapshot }
const LOG_PATH   = path.join(DATA, 'buyer-log.json');   // { [advOrderNo]: buyer record }
const UU_CACHE   = path.join(DATA, 'uu-cache.json');    // { [advOrderNo]: userInfo } detail cache

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function writeJson(p, o) { try { fs.writeFileSync(p, JSON.stringify(o, null, 2)); } catch {} }

// Serialize all capture operations through one promise chain (simple mutex).
let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {}); // never let one failure poison the chain
  return run;
}

// ── Order-state helpers ─────────────────────────────────────────────
function normState(s) {
  if (s === null || s === undefined) return -1;
  if (typeof s === 'number') return s;
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  const map = { NOT_PAID: 0, PAID: 1, WAIT_PROCESS: 2, PROCESSING: 3, DONE: 4, CANCEL: 5, CANCELLED: 5, INVALID: 6, REFUSE: 7, TIMEOUT: 8 };
  return map[String(s).toUpperCase()] ?? -1;
}
const ACTIVE = new Set([0, 1, 2, 3]);

// Fetch order detail with the shared uu-cache (one MEXC hit per order, ever).
async function getDetailCached(merchant, advOrderNo, cache) {
  let u = cache[advOrderNo];
  if (u && u.realName !== undefined && u.registryTime !== undefined) return { u, fetched: false, full: null };
  const d = await mexcGet('/api/v3/fiat/order/detail', { advOrderNo }, merchant.apiKey, merchant.apiSecret);
  const data = (d && d.data) || {};
  const ui = data.userInfo || {};
  u = { memberId: ui.memberId || ui.imId || null, nickName: ui.nickName || null, realName: ui.realName || null, registryTime: ui.registryTime || null };
  cache[advOrderNo] = u;
  return { u, fetched: true, full: data };
}

/**
 * Snapshot buyer trade stats for IN-PROGRESS orders (MEXC strips
 * userFiatStatistics once an order is DONE). Same behavior as the old
 * /capture-stats route body.
 */
function captureFtdByOrderNos(merchant, advOrderNos, MAX = 40) {
  return withLock(async () => {
    const store = readJson(FTD_PATH);
    let captured = 0;
    for (const no of advOrderNos) {
      if (!no || store[no]) continue;
      if (captured >= MAX) break;
      try {
        const d = await mexcGet('/api/v3/fiat/order/detail', { advOrderNo: no }, merchant.apiKey, merchant.apiSecret);
        const data = (d && d.data) || {};
        const fs2 = data.userFiatStatistics;
        if (!fs2) continue; // stats already gone — order completed uncaptured
        const u = data.userInfo || {};
        store[no] = {
          merchantId: merchant.id,
          memberId: u.memberId || u.imId || null,
          nickName: u.nickName || null,
          realName: u.realName || null,
          registryTime: u.registryTime || null,
          priorP2P: (Number(fs2.totalBuyCount) || 0) + (Number(fs2.totalSellCount) || 0),
          spotCount: Number(data.spotCount) || 0,
          completeRate: fs2.completeRate ?? null,
          capturedAt: Date.now(),
          capturedState: data.state || null,
        };
        captured++;
      } catch { /* skip; retried next cycle */ }
    }
    if (captured) writeJson(FTD_PATH, store);
    return { captured };
  });
}

/**
 * Record completed orders into the permanent buyer log.
 * orders: [{ advOrderNo, amount, usdt, fiatUnit, doneAt }]
 */
function captureBuyerLog(merchant, orders, MAX_FETCH = 30) {
  return withLock(async () => {
    const log = readJson(LOG_PATH);
    const cache = readJson(UU_CACHE);
    let added = 0, fetched = 0;
    for (const o of orders) {
      const no = o && o.advOrderNo;
      if (!no || log[no]) continue;
      let u;
      try {
        const r = await getDetailCached(merchant, no, cache);
        u = r.u; if (r.fetched) fetched++;
        if (r.fetched && fetched > MAX_FETCH) { delete cache[no]; break; }
      } catch { continue; }
      log[no] = {
        merchantId: merchant.id,
        realName: u.realName || null,
        nickName: u.nickName || null,
        memberId: u.memberId || null,
        doneAt: Number(o.doneAt) || Date.now(),
        amount: Number(o.amount) || 0,
        usdt: Number(o.usdt) || 0,
        fiatUnit: o.fiatUnit || '',
        addedAt: Date.now(),
      };
      added++;
    }
    if (fetched) writeJson(UU_CACHE, cache);
    if (added) writeJson(LOG_PATH, log);
    return { added, fetched };
  });
}

// ── Manual & imported entries ───────────────────────────────────────
// Entries that did NOT come from a MEXC order (typed by hand or imported from
// a CSV). They live in the SAME buyer-log file so they feed the duplicate-name
// index exactly like captured orders do — that index is the whole point of the
// feature. They are marked with `source` + `batchId` so a bad import can be
// undone in one go instead of row by row.
const MANUAL_MERCHANT_ID = 'manual';

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const rand4 = () => Math.random().toString(36).slice(2, 6);

function newEntryId() { return `M-${Date.now().toString(36)}-${rand4()}`; }
function newBatchId() { return `B-${Date.now().toString(36)}-${rand4()}`; }

/**
 * Append manual/imported buyer records.
 * entries: [{ realName, nickName?, doneAt?, amount?, usdt?, fiatUnit?, note?,
 *             advOrderNo?, force? }]
 * `force: true` means the caller already confirmed the duplicate-name warning.
 * Returns { added, batchId, skipped: [{ row, name, reason }] }.
 * Reasons: no_name | id_exists | duplicate_name
 */
function addBuyerLogEntries(entries, source = 'manual') {
  return withLock(async () => {
    const log = readJson(LOG_PATH);
    const batchId = newBatchId();

    // Name index of what's already stored, so duplicates are caught against
    // history AND against earlier rows of this same import.
    const seenNames = new Set();
    for (const r of Object.values(log)) if (r && r.realName) seenNames.add(normName(r.realName));

    const skipped = [];
    let added = 0;

    (Array.isArray(entries) ? entries : []).forEach((e, i) => {
      const row = e && e.row != null ? e.row : i + 1;
      const realName = String((e && e.realName) || '').trim();
      if (!realName) { skipped.push({ row, name: '', reason: 'no_name' }); return; }

      const id = String((e && e.advOrderNo) || '').trim() || newEntryId();
      if (log[id]) { skipped.push({ row, name: realName, reason: 'id_exists' }); return; }

      const key = normName(realName);
      if (seenNames.has(key) && !(e && e.force)) {
        skipped.push({ row, name: realName, reason: 'duplicate_name' });
        return;
      }

      const doneAt = Number(e.doneAt) > 0 ? Number(e.doneAt) : Date.now();
      log[id] = {
        merchantId: MANUAL_MERCHANT_ID,
        realName,
        nickName: (e.nickName && String(e.nickName).trim()) || null,
        memberId: null,
        doneAt,
        amount: Number(e.amount) || 0,
        usdt: Number(e.usdt) || 0,
        fiatUnit: (e.fiatUnit && String(e.fiatUnit).trim().toUpperCase()) || 'IDR',
        note: (e.note && String(e.note).trim()) || null,
        source,                    // 'manual' | 'import'
        batchId,
        addedAt: Date.now(),
      };
      seenNames.add(key);
      added++;
    });

    if (added) writeJson(LOG_PATH, log);
    return { added, batchId, skipped };
  });
}

/** Undo one import/manual batch. Only touches records that carry this batchId. */
function deleteBuyerLogBatch(batchId) {
  return withLock(async () => {
    const log = readJson(LOG_PATH);
    let removed = 0;
    for (const [id, r] of Object.entries(log)) {
      if (r && r.batchId === batchId) { delete log[id]; removed++; }
    }
    if (removed) writeJson(LOG_PATH, log);
    return { removed };
  });
}

/** Recent orders (last `hours`) for one merchant — small page cap: the worker
 *  only needs what's live right now, not history. */
async function fetchRecentOrders(merchant, hours = 24, maxPages = 3) {
  const now = Date.now();
  let all = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await mexcGet('/api/v3/fiat/market/order/pagination',
      { startTime: now - hours * 3600000, endTime: now, page, limit: 10 },
      merchant.apiKey, merchant.apiSecret);
    if (res.code !== 0) break;
    const items = Array.isArray(res.data) ? res.data : [];
    if (items.length === 0) break;
    all = all.concat(items);
    if (page >= (res.page?.totalPage || 1)) break;
  }
  return all.map(o => ({ ...o, _state: normState(o.state) }));
}

module.exports = {
  captureFtdByOrderNos, captureBuyerLog, fetchRecentOrders, normState, ACTIVE,
  addBuyerLogEntries, deleteBuyerLogBatch, MANUAL_MERCHANT_ID,
  FTD_PATH, LOG_PATH,
};

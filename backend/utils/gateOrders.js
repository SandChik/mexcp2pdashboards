const { gateGet, gatePost, okData, P } = require('./gateApi');
const A = require('./gateAdapter');

/**
 * Gate.io order/ad operations, already translated to the house shape.
 * Routes call these when merchant.platform === 'gate'; MEXC and BingX code
 * paths are untouched. Every function takes a merchant with a DECRYPTED
 * apiSecret (store.getMerchant) and returns exactly what the MEXC route would
 * have returned to the browser, so the frontend cannot tell the platforms
 * apart except by the `platform` tag.
 *
 * Gate specifics that shape this file:
 *   - Every order list call REQUIRES crypto_currency + fiat_currency. They
 *     come from the merchant record (`asset`, `fiat`; defaults USDT / IDR).
 *   - Running orders live on get_pending_transaction_list (tabs `pending`
 *     and `dispute`); finished ones on get_completed_transaction_list
 *     (paged, ≤ 200 per page, with a server-side time filter — unlike BingX).
 *   - List rows carry no unread count; the detail does (`im_unread`). The
 *     quick window therefore enriches a bounded number of RUNNING orders from
 *     their detail (cached 10 s) so the chat badge and the notifier's
 *     "pesan masuk" event work the same as on MEXC.
 *   - Release = confirm-receipt (SELL order), "I have paid" = confirm-payment
 *     (BUY order, optional payment_method = a pay TYPE string such as `bank`).
 */

const isGate = m => !!m && m.platform === 'gate';
const fiatOf = m => String((m && m.fiat) || 'IDR').toUpperCase();
const assetOf = m => String((m && m.asset) || 'USDT').toUpperCase();
const sec = ms => Math.floor(ms / 1000);
/** Gate declares txid/adv_no as integers; send a number when it is safe, else the string. */
const idNum = v => { const s = String(v); return /^\d{1,15}$/.test(s) ? Number(s) : s; };
const listOf = d => (Array.isArray(d?.list) ? d.list : (Array.isArray(d?.lists) ? d.lists : (Array.isArray(d) ? d : [])));
/** Envelope with the `.msg` alias the routes/browser already check. */
const withMsg = res => (res && typeof res === 'object' ? { ...res, msg: res.message ?? res.msg ?? '' } : res);

async function pendingList(m, orderTab, extra = {}, priority = false) {
  const res = await gatePost(P.PENDING_ORDERS, { crypto_currency: assetOf(m), fiat_currency: fiatOf(m), order_tab: orderTab, ...extra }, m.apiKey, m.apiSecret, { priority });
  const d = okData(res);
  return { items: listOf(d).map(o => A.normalizeListOrder(o, m, { dispute: orderTab === 'dispute' })), total: Number(d?.count) || 0 };
}
async function completedPage(m, { start, end, page = 1, perPage = 100, status = 'completed' }, priority = false) {
  const res = await gatePost(P.COMPLETED_ORDERS, {
    crypto_currency: assetOf(m), fiat_currency: fiatOf(m), status,
    start_time: sec(start), end_time: sec(end), page, per_page: perPage, query_dispute: 1,
  }, m.apiKey, m.apiSecret, { priority });
  const d = okData(res);
  return { items: listOf(d).map(o => A.normalizeListOrder(o, m)), total: Number(d?.count) || 0 };
}

/** Merge several lists; earlier lists win on a duplicate txid. Newest first. */
function merge(...lists) {
  const seen = new Set();
  return lists.flat().filter(o => (seen.has(o.advOrderNo) ? false : (seen.add(o.advOrderNo), true)))
    .sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
}

// ── Unread / deadline enrichment for running orders ─────────────────
const ENRICH_MAX = 8;
const ENRICH_TTL_MS = 10000;
const enrichCache = new Map(); // `${mid}:${txid}` -> { at, unread, deadline, complaining }
async function enrichRunning(m, orders) {
  const running = orders.filter(o => A.RUNNING_HOUSE.has(o.state)).slice(0, ENRICH_MAX);
  await Promise.all(running.map(async o => {
    const key = `${m.id}:${o.advOrderNo}`;
    let hit = enrichCache.get(key);
    if (!hit || Date.now() - hit.at > ENRICH_TTL_MS) {
      try {
        const d = await getDetail(m, o.advOrderNo, false);
        hit = { at: Date.now(), unread: d.unreadCount || 0, deadline: d.payTimeLimit, complaining: d.complained === true, state: d.state };
        enrichCache.set(key, hit);
      } catch { return; }
    }
    o.unreadCount = hit.unread;
    if (hit.deadline) o.payTimeLimit = hit.deadline;
    if (hit.complaining) { o.complaining = true; if (A.RUNNING_HOUSE.has(o.state)) o.state = 9; }
  }));
  for (const [k, v] of enrichCache) if (Date.now() - v.at > 5 * 60000) enrichCache.delete(k);
  return orders;
}

/**
 * Quick window (queue + panel polling): every running order (pending +
 * dispute tabs) plus what finished in the last 24 h. Three calls per cycle,
 * shared by every poller through the route's 3 s cache.
 */
async function fetchQuick(m) {
  const now = Date.now();
  const [pending, dispute, done] = await Promise.all([
    pendingList(m, 'pending'),
    pendingList(m, 'dispute').catch(() => ({ items: [] })), // a tab Gate may refuse for some accounts must not blank the list
    completedPage(m, { start: now - 86400000, end: now, perPage: 100 }),
  ]);
  return enrichRunning(m, merge(dispute.items, pending.items, done.items));
}

/**
 * Date-range fetch. Gate filters server-side (seconds), so this is the
 * completed list paged newest→oldest until `count` is reached, plus the
 * running orders inside the range. Cap 10 pages × 200 = 2,000 orders.
 */
async function fetchRange(m, startTime, endTime, maxPages = 10) {
  const start = Number(startTime) || 0, end = Number(endTime) || Date.now();
  const extra = { start_time: sec(start), end_time: sec(end) };
  const [pending, dispute] = await Promise.all([
    pendingList(m, 'pending', extra).catch(() => ({ items: [] })),
    pendingList(m, 'dispute', extra).catch(() => ({ items: [] })),
  ]);
  const seen = new Set();
  let all = [], total = null, pages = 0, oldest = null, stop = 'end';
  const pageSize = 200;
  for (let page = 1; page <= maxPages; page++) {
    const r = await completedPage(m, { start, end, page, perPage: pageSize });
    pages++;
    if (total === null) total = r.total;
    if (r.items.length === 0) { stop = 'empty'; break; }
    for (const o of r.items) if (!seen.has(o.advOrderNo)) { seen.add(o.advOrderNo); all.push(o); }
    const pageOldest = Math.min(...r.items.map(o => o.createTime || Infinity));
    if (oldest === null || pageOldest < oldest) oldest = pageOldest;
    if (r.items.length < pageSize) { stop = 'last'; break; }
    if (total && all.length >= total) { stop = 'total'; break; }
    if (page === maxPages) stop = 'budget';
  }
  const items = merge(dispute.items, pending.items, all)
    .filter(o => o.createTime === null || (o.createTime >= start && o.createTime <= end));
  items.meta = { platform: 'gate', total, fetched: all.length, pages, pageSize, oldest: Number.isFinite(oldest) ? oldest : null, stop, start, end, truncated: stop === 'budget' };
  return items;
}

/** Detail, house-shaped (detail convention: side inverted). */
async function getDetail(m, txid, priority = true) {
  const res = await gatePost(P.ORDER_DETAIL, { txid: idNum(txid) }, m.apiKey, m.apiSecret, { priority });
  return A.normalizeDetail(okData(res), m);
}

/** SELL order: "fiat received" → coins released to the buyer. */
async function confirmReceipt(m, txid) {
  return withMsg(await gatePost(P.CONFIRM_RECEIPT, { txid: String(txid) }, m.apiKey, m.apiSecret, { priority: true }));
}
/** BUY order: "I have paid". payment_method is optional and must be one of the order's supported pay TYPES. */
async function confirmPayment(m, txid, paymentMethod) {
  const body = { txid: String(txid) };
  if (paymentMethod && /^[a-z_]+$/i.test(String(paymentMethod))) body.payment_method = String(paymentMethod);
  return withMsg(await gatePost(P.CONFIRM_PAYMENT, body, m.apiKey, m.apiSecret, { priority: true }));
}
async function cancelOrder(m, txid, reasonId = '7', memo = '') {
  return withMsg(await gatePost(P.CANCEL_ORDER, { txid: String(txid), reason_id: String(reasonId), reason_memo: memo || undefined }, m.apiKey, m.apiSecret, { priority: true }));
}

// ── Payment methods (shared by ads + the ad form) ───────────────────
const payCache = new Map(); // mid -> { at, list }
/**
 * The merchant's saved receiving accounts, flattened for a picker:
 *   { id, payType, payName, name, account, payee, summary }
 * Gate groups them by pay type; the bank group uses `bankid` as the key,
 * other groups use `id`. One account per type can be attached to an ad.
 */
async function myPaymentMethods(m, { fresh = false } = {}) {
  const hit = payCache.get(m.id);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60000) return hit.list;
  let res = await gatePost(P.MY_PAYMENTS, { fiat: fiatOf(m) }, m.apiKey, m.apiSecret, { priority: true });
  let groups = Array.isArray(okData(res)) ? res.data : [];
  if (groups.length === 0) { // nothing bound for this fiat → show everything the account has
    res = await gatePost(P.MY_PAYMENTS, {}, m.apiKey, m.apiSecret, { priority: true });
    groups = Array.isArray(okData(res)) ? res.data : [];
  }
  const list = [];
  for (const g of groups) {
    const type = g.pay_type || '';
    for (const it of Array.isArray(g.list) ? g.list : []) {
      const id = String(it.id ?? it.bankid ?? '');
      if (!id) continue;
      const name = it.bankname || g.pay_name || type;
      const account = it.bankaddr || it.account || '';
      const payee = it.real_name || it.hold_username || '';
      list.push({
        id, payType: type, payName: g.pay_name || type, name, account, payee,
        summary: [name, account, payee, it.account_des, it.bankbranch].filter(Boolean).join(' · '),
        _gate: it,
      });
    }
  }
  payCache.set(m.id, { at: Date.now(), list });
  return list;
}
async function paymentNames(m) {
  try {
    const list = await myPaymentMethods(m);
    const byId = {}, byType = {};
    list.forEach(p => { byId[p.id] = p.account ? `${p.name} ${p.account}` : p.name; if (!byType[p.payType]) byType[p.payType] = p.payName; });
    return { byId, byType };
  } catch { return {}; }
}

async function listAds(m) {
  const [res, names] = await Promise.all([
    gatePost(P.MY_ADS, { asset: assetOf(m), fiat_unit: fiatOf(m) }, m.apiKey, m.apiSecret, { priority: true }),
    paymentNames(m),
  ]);
  return listOf(okData(res)).map(a => A.normalizeAd(a, names));
}

/** Market ads (other merchants). tradeType: 'buy' | 'sell' | 1 (buy) | 2 (sell). */
async function marketAds(m, { asset, fiatUnit, tradeType = 'sell' } = {}) {
  const side = String(tradeType) === '1' || String(tradeType).toLowerCase() === 'buy' ? 'buy' : 'sell';
  const res = await gatePost(P.MARKET_ADS, { asset: asset || assetOf(m), fiat_unit: fiatUnit || fiatOf(m), trade_type: side }, m.apiKey, m.apiSecret, { priority: true });
  return listOf(okData(res)).map(a => ({
    platform: 'gate',
    advNo: String(a.adv_no),
    side: side.toUpperCase(),
    nickName: a.nick_name,
    price: a.price,
    availableAmount: a.surplus_amount,
    minAmount: a.fiat_min_amount ?? a.min_single_trans_amount,
    maxAmount: a.fiat_max_amount ?? a.max_single_trans_amount,
    fiatUnit: a.fiat_unit,
    coinName: a.asset,
    payMethodNames: (a.trade_methods || []).map(t => t.trade_method_name || t.pay_type).filter(Boolean),
    _gate: a,
  }));
}

/** USDT (or the merchant's asset) spot balance — the account P2P ads sell from on Gate. */
async function balance(m) {
  try {
    const res = await gateGet(P.SPOT_ACCOUNTS, { currency: assetOf(m) }, m.apiKey, m.apiSecret, { priority: true });
    const rows = okData(res);
    const u = (Array.isArray(rows) ? rows : [rows]).find(r => r && String(r.currency || '').toUpperCase() === assetOf(m));
    if (!u) return { free: '0', locked: '0', source: 'spot' };
    return { free: String(u.available ?? '0'), locked: String(u.locked ?? '0'), source: 'spot' };
  } catch (e) {
    return { free: null, locked: null, source: null, error: e.gate?.msg || e.message };
  }
}

/** Merchant account info (work status, online status, username, stats). */
async function accountInfo(m, priority = false) {
  const res = await gatePost(P.USER_INFO, {}, m.apiKey, m.apiSecret, { priority });
  return okData(res) || {};
}
/** Gate's merchant switch: work_status 1 = working (ads visible), 0 = resting. */
async function setWorkStatus(m, open) {
  return withMsg(await gatePost(P.WORK_HOURS, { work_status: open ? 1 : 0 }, m.apiKey, m.apiSecret, { priority: true }));
}

/** "Tes koneksi" — read-only probe from inside the dashboard. */
async function connectionTest(m) {
  const steps = [];
  let driftMs = null, orders = 0, ads = 0, account = null, bal = null;
  const run = async (name, fn) => {
    const t0 = Date.now();
    try {
      const res = await fn();
      if (driftMs === null && res && res.timestamp) driftMs = Math.round(Number(res.timestamp) * 1000) - t0;
      const ok = res && res.code === 0;
      steps.push({ name, ok, code: res?.code, msg: ok ? '' : (res?.message || res?.msg || ''), ms: Date.now() - t0 });
      return ok ? res.data : null;
    } catch (e) {
      steps.push({ name, ok: false, code: e.gate?.code ?? null, msg: e.gate?.msg || e.message, ms: Date.now() - t0 });
      return null;
    }
  };
  const ui = await run('Info akun merchant (get_user_info)', () => gatePost(P.USER_INFO, {}, m.apiKey, m.apiSecret, { priority: true }));
  if (ui) account = { userName: ui.user_name, workStatus: ui.work_status, onlineStatus: ui.online_status, verified: ui.verified, completeRateMonth: ui.complete_rate_month, transactionsMonth: ui.transactions_month };
  const my = await run('Iklan saya (my_ads_list)', () => gatePost(P.MY_ADS, { asset: assetOf(m), fiat_unit: fiatOf(m) }, m.apiKey, m.apiSecret, { priority: true }));
  ads = listOf(my).length;
  const pl = await run(`Order berjalan (pending, ${assetOf(m)}/${fiatOf(m)})`, () => gatePost(P.PENDING_ORDERS, { crypto_currency: assetOf(m), fiat_currency: fiatOf(m), order_tab: 'pending' }, m.apiKey, m.apiSecret, { priority: true }));
  orders = Number(pl?.count) || listOf(pl).length;
  await run('Metode bayar saya (get_myself_payment)', () => gatePost(P.MY_PAYMENTS, { fiat: fiatOf(m) }, m.apiKey, m.apiSecret, { priority: true }));
  const sb = await run(`Saldo spot ${assetOf(m)} (GET /spot/accounts)`, () => gateGet(P.SPOT_ACCOUNTS, { currency: assetOf(m) }, m.apiKey, m.apiSecret, { priority: true }));
  if (Array.isArray(sb) && sb[0]) bal = { free: sb[0].available, locked: sb[0].locked };
  return { ok: steps.every(s => s.ok), steps, driftMs, orders, ads, account, balance: bal, fiat: fiatOf(m), asset: assetOf(m) };
}

module.exports = {
  isGate, fiatOf, assetOf, idNum, withMsg,
  fetchQuick, fetchRange, getDetail, confirmReceipt, confirmPayment, cancelOrder,
  myPaymentMethods, listAds, marketAds, balance, accountInfo, setWorkStatus, connectionTest,
};

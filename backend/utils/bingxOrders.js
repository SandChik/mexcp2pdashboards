const { bingxGet, bingxPost, P, POST_MODE } = require('./bingxApi');
const A = require('./bingxAdapter');

/**
 * BingX order/ad operations, already translated to the house shape.
 * Routes call these when merchant.platform === 'bingx'; MEXC code paths are
 * untouched. Every function here takes a merchant with a DECRYPTED apiSecret
 * (store.getMerchant) and returns exactly what the MEXC route would have
 * returned to the browser, so the frontend cannot tell the platforms apart
 * except by the `platform` tag.
 */

const isBingx = m => !!m && m.platform === 'bingx';

function okData(res) {
  if (!res || res.code !== 0) {
    const err = new Error(`BingX ${res?.code ?? '?'}: ${res?.msg || 'unknown error'}`);
    err.bingx = res; throw err;
  }
  return res.data;
}
const resultOf = d => (Array.isArray(d?.result) ? d.result : (Array.isArray(d) ? d : []));

/** One page of the merchant's order list. type: 0 all, 1 in progress, 4 ended. */
async function listPage(m, type, pageId, pageSize, priority = false) {
  const res = await bingxGet(P.ORDER_LIST, { type, pageId, pageSize }, m.apiKey, m.apiSecret, { priority });
  const d = okData(res);
  return { items: resultOf(d).map(o => A.normalizeListOrder(o, m)), total: Number(d?.total) || 0 };
}

/**
 * Quick window (queue + panel polling): everything in progress plus the most
 * recent ended orders — the latter so a transition INTO done/cancelled is
 * announced instead of the order silently vanishing from the running list.
 * Two calls per cycle, shared by every poller through the route's 3s cache.
 */
async function fetchQuick(m) {
  const [running, ended] = await Promise.all([listPage(m, 1, 0, 100), listPage(m, 4, 0, 20)]);
  const seen = new Set();
  return running.items.concat(ended.items)
    .filter(o => (seen.has(o.advOrderNo) ? false : (seen.add(o.advOrderNo), true)))
    .sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
}

/**
 * Date-range fetch. BingX has no time filter, so page newest→oldest through
 * "all orders" until the page's oldest row predates the range (max 6 pages =
 * 600 orders — the dashboard's own range is capped at 8 days anyway).
 */
async function fetchRange(m, startTime, endTime, maxPages = 6) {
  const start = Number(startTime) || 0, end = Number(endTime) || Date.now();
  let all = [];
  for (let page = 0; page < maxPages; page++) {
    const { items } = await listPage(m, 0, page, 100);
    if (items.length === 0) break;
    all = all.concat(items);
    const oldest = Math.min(...items.map(o => o.createTime || Infinity));
    if (oldest < start || items.length < 100) break;
  }
  return all.filter(o => o.createTime === null || (o.createTime >= start && o.createTime <= end));
}

/** Detail, house-shaped (detail convention: side inverted). */
async function getDetail(m, orderNo, priority = true) {
  const res = await bingxGet(P.ORDER_DETAIL, { orderNo: String(orderNo) }, m.apiKey, m.apiSecret, { priority });
  const d = okData(res);
  return A.normalizeDetail(d, m);
}

/**
 * Order actions. action: 1 cancel, 2 send our payment info to the taker,
 * 3 "paid / received" — for a SELL order this is the release, for a BUY order
 * it is our "I have paid". Returns BingX's raw { code, msg } so the browser's
 * existing `r.data?.code === 0` check keeps working.
 */
async function modifyStatus(m, orderNo, action, extra = {}) {
  return bingxPost(P.ORDER_STATUS, { orderNo: String(orderNo), action, ...extra }, m.apiKey, m.apiSecret, { priority: true });
}

/** KYC names for the panel rows — same contract as the MEXC member-ids route. */
async function resolveMembers(m, orderNos, cache, MAX_FETCH = 30) {
  const map = {};
  let fetched = 0, fromCache = 0, capped = false;
  for (const no of orderNos) {
    if (cache[no] && cache[no].realName !== undefined) { map[no] = cache[no]; fromCache++; continue; }
    if (fetched >= MAX_FETCH) { capped = true; continue; }
    try {
      const d = await getDetail(m, no, false);
      const rec = { memberId: d.userInfo.memberId, nickName: d.userInfo.nickName, realName: d.userInfo.realName, registryTime: null, platform: 'bingx' };
      map[no] = rec; cache[no] = rec; fetched++;
    } catch { /* skip unresolved */ }
  }
  return { map, fetched, fromCache, capped, max: MAX_FETCH };
}

async function listAds(m) {
  const res = await bingxGet(P.MY_ADVERTS, { pageId: 0, pageSize: 100 }, m.apiKey, m.apiSecret, { priority: true });
  return resultOf(okData(res)).map(A.normalizeAd);
}

async function marketAds(m, { asset = 'USDT', fiatUnit = 'IDR', tradeType = 1, pageSize = 20 } = {}) {
  const res = await bingxGet(P.ADVERT_LIST, { asset, fiatUnit, tradeType: Number(tradeType), pageId: 0, pageSize }, m.apiKey, m.apiSecret, { priority: true });
  return resultOf(okData(res)).map(a => ({
    platform: 'bingx',
    advNo: String(a.advertNo),
    side: A.sideOf(a.tradeType),           // maker perspective
    nickName: a.nickname,
    price: a.price,
    availableAmount: a.availableAmount,
    minAmount: a.minPerOrderAmount,
    maxAmount: a.maxPerOrderAmount,
    fiatUnit: a.fiatUnit,
    coinName: a.asset,
    payMethodNames: (a.paymentMethods || []).map(p => p.name).filter(Boolean),
    recent30DaysTradeNum: a.recent30DaysTradeNum,
    _bingx: a,
  }));
}

/**
 * "Tes koneksi" — the probe, from inside the dashboard. Read-only unless
 * `post` is true, in which case the first ad's price is rewritten to its own
 * current value (a no-op) to confirm the POST body format.
 */
async function connectionTest(m, { post = false } = {}) {
  const steps = [];
  let driftMs = null, firstAd = null, orders = 0;
  const run = async (name, fn) => {
    const t0 = Date.now();
    try {
      const res = await fn();
      if (driftMs === null && res && res.timestamp) driftMs = Number(res.timestamp) - t0;
      const ok = res && res.code === 0;
      steps.push({ name, ok, code: res?.code, msg: ok ? '' : (res?.msg || ''), ms: Date.now() - t0 });
      return ok ? res.data : null;
    } catch (e) {
      steps.push({ name, ok: false, code: e.bingx?.code ?? null, msg: e.bingx?.msg || e.message, ms: Date.now() - t0 });
      return null;
    }
  };
  const my = await run('Iklan saya (myAdvert)', () => bingxGet(P.MY_ADVERTS, { pageId: 0, pageSize: 5 }, m.apiKey, m.apiSecret, { priority: true }));
  firstAd = resultOf(my)[0] || null;
  const ol = await run('Daftar order (order/list)', () => bingxGet(P.ORDER_LIST, { type: 0, pageId: 0, pageSize: 1 }, m.apiKey, m.apiSecret, { priority: true }));
  orders = Number(ol?.total) || resultOf(ol).length;
  await run('Metode bayar saya (userPaymentMethod/list)', () => bingxGet(P.MY_PAYMENT_METHODS, {}, m.apiKey, m.apiSecret, { priority: true }));
  let postResult = null;
  if (post) {
    if (!firstAd) postResult = { ok: false, msg: 'Tidak ada iklan untuk uji POST' };
    else {
      const biz = { advertNo: String(firstAd.advertNo), priceType: Number(firstAd.priceType) };
      if (biz.priceType === 2) biz.floatRatio = String(firstAd.floatRatio); else biz.fixedPrice = String(firstAd.fixedPrice);
      const t0 = Date.now();
      try {
        const res = await bingxPost(P.ADVERT_PRICE, biz, m.apiKey, m.apiSecret, { priority: true });
        postResult = { ok: res?.code === 0, code: res?.code, msg: res?.msg || '', mode: POST_MODE, advertNo: biz.advertNo, ms: Date.now() - t0 };
      } catch (e) {
        postResult = { ok: false, code: e.bingx?.code ?? null, msg: e.bingx?.msg || e.message, mode: POST_MODE, ms: Date.now() - t0 };
      }
    }
  }
  return { ok: steps.every(s => s.ok) && (!post || (postResult && postResult.ok)), steps, driftMs, orders, ads: resultOf(my).length, post: postResult, postMode: POST_MODE };
}

module.exports = {
  isBingx, fetchQuick, fetchRange, getDetail, modifyStatus, resolveMembers, listAds, marketAds, connectionTest,
};

/**
 * BingX → "house shape" translator.
 *
 * The dashboard's queue, actions, sounds and modal are written for MEXC's
 * order shape. Instead of teaching every screen a second vocabulary, BingX
 * orders are translated ONCE, here, into that same shape plus a `platform`
 * tag. Two conventions are preserved on purpose, because actions.js and
 * OrderDetailModal depend on them:
 *
 *   LIST   → `side` is OURS   (SELL = we sell USDT → we release)
 *   DETAIL → `side` is THEIRS (inverted), exactly like MEXC's detail endpoint
 *
 * BingX itself reports tradeType from the maker (= merchant) perspective on
 * both endpoints (verified: a sell-side merchant's orders came back as
 * tradeType=2). The inversion below is therefore applied by us, only on
 * detail, only to match what the UI already expects.
 *
 * State mapping (BingX orderStatus → house state, MEXC numbering):
 *   1 in progress      → 0 Belum bayar
 *   4 paid             → 1 Sudah bayar
 *   5 completed        → 4 Selesai
 *   2 user cancelled   → 5 Dibatalkan
 *   3 timeout          → 8 Timeout
 *   6 appeal           → 9 Banding   (new house state; never actionable)
 */

const STATE_MAP = { 1: 0, 4: 1, 5: 4, 2: 5, 3: 8, 6: 9 };
const RUNNING_HOUSE = new Set([0, 1, 2, 3, 9]);

function houseState(orderStatus) {
  const n = Number(orderStatus);
  return Object.prototype.hasOwnProperty.call(STATE_MAP, n) ? STATE_MAP[n] : -1;
}
function sideOf(tradeType) { return Number(tradeType) === 1 ? 'BUY' : 'SELL'; }
function invert(side) { return side === 'BUY' ? 'SELL' : 'BUY'; }

// "Mon Sep 07 19:37:26 CST 2026" — Java Date.toString(). CST here is China
// Standard Time (UTC+8): verified against wall-clock time on a live order.
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const ZONE_OFFSET_MIN = { CST: 480, UTC: 0, GMT: 0, HKT: 480, SGT: 480, JST: 540, WIB: 420, WITA: 480, WIT: 540 };
function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const s = String(v).trim();
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  const m = s.match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([A-Z]{3,4})\s+(\d{4})$/);
  if (m) {
    const [, mon, d, h, mi, sec, zone, y] = m;
    const off = ZONE_OFFSET_MIN[zone] ?? 480;
    return Date.UTC(Number(y), MONTHS[mon] ?? 0, Number(d), Number(h), Number(mi), Number(sec)) - off * 60000;
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/** Deadline as an absolute timestamp, the way the UI counts down. */
function deadlineOf(o, createTime, state) {
  if (o.remainingOrderExpirySeconds !== undefined && o.remainingOrderExpirySeconds !== null) {
    const s = Number(o.remainingOrderExpirySeconds);
    if (!isNaN(s) && s > 0) return Date.now() + s * 1000;
  }
  if (state === 0 && createTime && o.expiryMinutes) return createTime + Number(o.expiryMinutes) * 60000;
  return null;
}

/** Pull account / payee out of a BingX payment method's dynamic field list. */
function flattenFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const byName = re => list.find(f => re.test(String(f.name || '')));
  const numeric = list.find(f => Number(f.contentType) === 1);
  const payee = byName(/nama|name|holder|penerima|payee|owner/i);
  const account = numeric || byName(/rekening|account|nomor|number|\bno\b|\bid\b|phone|hp/i);
  return {
    payee: payee ? String(payee.value ?? '') : '',
    account: account ? String(account.value ?? '') : '',
    all: list.map(f => `${f.name}: ${f.value ?? ''}`).join(' · '),
  };
}
function paymentEntry(pm) {
  const f = flattenFields(pm.fields);
  return {
    id: pm.userPaymentMethodId ?? pm.id,
    payMethod: pm.name || `Method ${pm.id}`, // non-numeric → helpers.getBankName shows the name as-is
    bankName: pm.name || '',
    account: f.account,
    payee: f.payee,
    detail: f.all,
    _bingx: { id: pm.id, userPaymentMethodId: pm.userPaymentMethodId, fields: pm.fields || [] },
  };
}

/** LIST row → house shape (our perspective). */
function normalizeListOrder(o, merchant) {
  const state = houseState(o.orderStatus);
  const side = sideOf(o.tradeType);
  const createTime = parseTime(o.createTime);
  const nick = side === 'SELL' ? o.buyerNickname : (o.sellerNickname || o.buyerNickname);
  return {
    platform: 'bingx',
    advOrderNo: String(o.orderNo),
    advNo: o.advertNo !== undefined ? String(o.advertNo) : undefined,
    merchantId: merchant ? merchant.id : undefined,
    side,
    state,
    amount: o.amount,
    tradableQuantity: o.number,
    price: o.price,
    fiatUnit: o.fiatUnit,
    coinName: o.asset || 'USDT',
    createTime,
    updateTime: undefined,
    payTimeLimit: deadlineOf(o, createTime, state),
    unreadCount: Number(o.chatUnreadCount) || 0,
    userInfo: { nickName: nick || '' },
    _bingx: {
      orderStatus: Number(o.orderStatus),
      tradeType: Number(o.tradeType),
      expiryMinutes: o.expiryMinutes,
      paymentInfoSentStatus: o.paymentInfoSentStatus,
    },
  };
}

/** DETAIL → house shape with `side` INVERTED (counterpart perspective, like MEXC detail). */
function normalizeDetail(d, merchant) {
  const base = normalizeListOrder(d, merchant);
  const ourSide = base.side;
  const weSell = ourSide === 'SELL';
  const cp = (weSell ? d.buyerInfo : d.sellerInfo) || {};
  const us = (weSell ? d.sellerInfo : d.buyerInfo) || {};
  const methods = (Array.isArray(d.userPaymentMethods) ? d.userPaymentMethods : []).map(paymentEntry);
  return {
    ...base,
    side: invert(ourSide),          // detail convention: THEIR side
    _ourSide: ourSide,
    userInfo: {
      memberId: cp.uid !== undefined ? String(cp.uid) : null,
      nickName: cp.nickname || base.userInfo.nickName || '',
      realName: cp.realName || null,
      kycLevel: undefined,
    },
    _self: { memberId: us.uid !== undefined ? String(us.uid) : null, nickName: us.nickname || '', realName: us.realName || null },
    // When WE sell, the order's payment methods are OURS (what the buyer pays
    // into). They are deliberately NOT put in paymentInfo/confirmPaymentInfo:
    // the release dialog would then print our own bank as if it were the
    // buyer's. The modal shows them under their own heading instead.
    // When WE buy, they are the seller's — the account we have to pay.
    merchantPaymentInfo: weSell ? methods : [],
    paymentInfo: weSell ? [] : methods,
    confirmPaymentInfo: weSell ? null : (methods[0] || null),
    hidePaymentInfo: d.hidePaymentInfo,
    _bingx: { ...base._bingx, hidePaymentInfo: d.hidePaymentInfo },
  };
}

/** myAdvert row → the fields the (read-only) BingX ads tab shows. */
function normalizeAd(a) {
  const floating = Number(a.priceType) === 2;
  return {
    platform: 'bingx',
    advNo: String(a.advertNo),
    side: sideOf(a.tradeType),
    priceType: Number(a.priceType),
    price: floating ? null : a.fixedPrice,
    floatRatio: floating ? a.floatRatio : null,
    availableAmount: a.availableAmount,
    totalNumber: a.totalNumber,
    minAmount: a.minAmount,
    maxAmount: a.maxAmount,
    fiatUnit: a.fiatUnit,
    coinName: a.asset || 'USDT',
    advStatus: Number(a.status) === 0 ? 'OPEN' : 'CLOSE',   // myAdvert: 0 listed, 1 delisted
    paymentTimeLimit: a.paymentTimeLimit,
    payMethodNames: (Array.isArray(a.paymentMethods) ? a.paymentMethods : []).map(p => p.name).filter(Boolean),
    hidePaymentInfo: a.hidePaymentInfo,
    _bingx: a,
  };
}

module.exports = {
  STATE_MAP, RUNNING_HOUSE, houseState, sideOf, parseTime, deadlineOf,
  normalizeListOrder, normalizeDetail, normalizeAd, flattenFields,
};

/**
 * Gate.io → "house shape" translator (the Gate twin of bingxAdapter.js).
 *
 * The dashboard's queue, actions, sounds and modal are written for MEXC's
 * order shape. Gate orders are translated ONCE, here, into that same shape
 * plus a `platform: 'gate'` tag. The two conventions actions.js and
 * OrderDetailModal depend on are preserved:
 *
 *   LIST   → `side` is OURS   (SELL = we sell USDT → we release)
 *   DETAIL → `side` is THEIRS (inverted), exactly like MEXC's detail endpoint
 *
 * Gate reports `type_buy` (list) and `is_sell` (detail) from the CURRENT
 * USER's view — both already ours; the inversion on detail is applied by us,
 * only to match what the UI expects.
 *
 * Field vocabulary (Gate → house), the ones that are easy to get backwards:
 *   amount  = crypto size   → tradableQuantity
 *   total   = fiat amount   → amount
 *   rate    = price         → price
 *   want_type / currency_type → fiatUnit / coinName
 *   txid    = order id      → advOrderNo (string)
 *
 * Status mapping (Gate display status → house state, MEXC numbering):
 *   unpay, hide_payment, TEMP  → 0 Belum bayar
 *   paid, unconfirmed          → 1 Sudah bayar (buyer marked paid; seller to confirm)
 *   locked                     → 9 Banding  (LOCKED = order frozen pending review /
 *                                 dispute — never actionable from here; see README)
 *   finished, bclosed          → 4 Selesai  (bclosed = arbitration ruled "filled")
 *   cancel, sclosed, becancel  → 5 Dibatalkan
 *   expired                    → 8 Timeout
 *   anything else              → 10 Status ? (shown with the raw string)
 * Orders returned by the `dispute` tab are tagged state 9 + complaining=true
 * regardless of their display status.
 */

const STATE_MAP = {
  unpay: 0, hide_payment: 0, temp: 0, open: 0,
  paid: 1, unconfirmed: 1,
  locked: 9,
  finished: 4, accept: 4, bclosed: 4,
  cancel: 5, cancelled: 5, becancel: 5, scancel: 5, sclosed: 5,
  expired: 8,
};
const RUNNING_HOUSE = new Set([0, 1, 2, 3, 9, 10]);

function houseState(status) {
  const k = String(status ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATE_MAP, k) ? STATE_MAP[k] : 10;
}
function invert(side) { return side === 'BUY' ? 'SELL' : 'BUY'; }
const str = v => (v === undefined || v === null ? undefined : String(v));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Gate times are unix SECONDS (int, float or string). → ms, or null. */
function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 1e12 ? Math.round(v) : Math.round(v * 1000);
  const s = String(v).trim();
  if (/^\d{13}(\.\d+)?$/.test(s)) return Math.round(Number(s));
  if (/^\d{9,10}(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  // "2025-12-15 08:27:09" — Gate's formatted strings have no zone; the
  // platform reports in UTC+8. Only a fallback: the numeric fields win.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600000;
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/** One payment entry in MEXC's vocabulary ({ id, payMethod, bankName, account, payee }). */
function paymentEntry({ id, type, name, bankName, account, payee, branch, memo }) {
  return {
    id: str(id) || type || '',
    payType: type || '',
    payMethod: name || bankName || type || '',   // non-numeric → helpers.getBankName shows it as-is
    bankName: bankName || name || '',
    account: account || '',
    payee: payee || '',
    ...(branch ? { bankAddress: branch } : {}),
    ...(memo ? { detail: memo } : {}),
  };
}

/** Payment accounts attached to an order DETAIL, in display order. */
function paymentsOfDetail(d) {
  const out = [];
  if (String(d.show_bank) === '1' || d.bankname || d.bankid) {
    out.push(paymentEntry({ id: 'bank', type: 'bank', name: d.bankname || 'Bank Transfer', bankName: d.bankname, account: d.bankid, payee: d.bank_holder_realname, branch: d.bankbranch }));
  }
  if (String(d.show_ali) === '1' || d.aliname) out.push(paymentEntry({ id: 'alipay', type: 'alipay', name: 'Alipay', account: d.aliname }));
  if (String(d.show_wechat) === '1' || d.wename) out.push(paymentEntry({ id: 'wechat', type: 'wechat', name: 'WeChat Pay', account: d.wename }));
  for (const p of Array.isArray(d.pay_others) ? d.pay_others : []) {
    if (!p) continue;
    out.push(paymentEntry({ id: p.pay_type || p.id, type: p.pay_type, name: p.pay_name || p.account_des || p.pay_type, account: p.account, payee: p.real_name, memo: [p.account_des, p.memo].filter(Boolean).join(' · ') }));
  }
  return out;
}

/** Deadline as an absolute timestamp, the way the UI counts down. */
function deadlineOfList(o, state) {
  const cd = num(o.cd_time);
  if (cd !== null && cd > 0 && RUNNING_HOUSE.has(state)) return Date.now() + cd * 1000;
  if (state === 0) return parseTime(o.timest_expire);
  return null;
}

/** LIST row (pending / completed / dispute tab) → house shape (our perspective). */
function normalizeListOrder(o, merchant, { dispute = false } = {}) {
  const rawStatus = String(o.status ?? '');
  let state = houseState(rawStatus);
  if (dispute && RUNNING_HOUSE.has(state)) state = 9;
  const side = Number(o.type_buy) === 1 ? 'BUY' : 'SELL';
  const createTime = parseTime(o.timestamp) ?? parseTime(o.timest);
  return {
    platform: 'gate',
    advOrderNo: String(o.txid),
    merchantId: merchant ? merchant.id : undefined,
    side,
    state,
    amount: o.total,                 // fiat
    tradableQuantity: o.amount,      // crypto
    price: o.rate,
    fiatUnit: o.want_type || (merchant && merchant.fiat) || 'IDR',
    coinName: o.currency_type || 'USDT',
    createTime,
    updateTime: undefined,
    payTimeLimit: deadlineOfList(o, state),
    unreadCount: 0,                  // list rows carry no unread count; detail does (im_unread)
    complaining: dispute || undefined,
    userInfo: {
      nickName: o.its_nick || o.its_nickname || '',
      realName: o.its_realname || null,
      memberId: o.its_uid ? String(o.its_uid) : null,
    },
    _gate: {
      status: rawStatus,
      orderType: num(o.order_type),
      cancelable: num(o.cancelable),
      selPaytype: o.sel_paytype || '',
      hidePayment: num(o.hide_payment),
      dispute,
      tags: Array.isArray(o.order_tag) ? o.order_tag : [],
    },
  };
}

/** DETAIL → house shape with `side` INVERTED (counterpart perspective, like MEXC detail). */
function normalizeDetail(d, merchant) {
  const ourSide = Number(d.is_sell) === 1 ? 'SELL' : 'BUY';
  const rawStatus = String(d.status ?? '');
  let state = houseState(rawStatus);
  const appeal = Number(d.in_appeal) === 1;
  if (appeal && RUNNING_HOUSE.has(state)) state = 9;
  const createTime = parseTime(d.timest);
  const remain = num(d.remain_pay_time);
  const deadline = state === 0
    ? (parseTime(d.last_pay_time) ?? (remain !== null && remain > 0 ? Date.now() + remain * 1000 : null))
    : null;
  const methods = paymentsOfDetail(d);
  const sel = d.sel_paytype ? methods.find(p => p.payType === d.sel_paytype) : null;
  return {
    platform: 'gate',
    advOrderNo: String(d.txid),
    merchantId: merchant ? merchant.id : undefined,
    side: invert(ourSide),           // detail convention: THEIR side
    _ourSide: ourSide,
    state,
    amount: d.total,
    tradableQuantity: d.amount,
    price: d.rate,
    fiatUnit: d.want_type || (merchant && merchant.fiat) || 'IDR',
    coinName: d.currency_type || 'USDT',
    createTime,
    updateTime: parseTime(d.timest_paid) ?? undefined,
    payTimeLimit: deadline,
    unreadCount: num(d.im_unread) || 0,
    complained: appeal || undefined,
    userInfo: {
      memberId: d.its_uid ? String(d.its_uid) : null,
      nickName: d.its_nickname || '',
      realName: d.its_realname || null,
      kycLevel: undefined,
    },
    _self: { memberId: null, nickName: '', realName: d.own_realname || null },
    // Same meaning MEXC gives them: when we sell these are OUR accounts the
    // buyer pays into; when we buy they are the seller's account we must pay.
    merchantPaymentInfo: methods,
    paymentInfo: methods,
    confirmPaymentInfo: sel || methods[0] || null,
    hidePaymentInfo: num(d.hide_payment),
    tradeTerms: d.trade_tips || '',
    _gate: {
      status: rawStatus,
      orderid: str(d.orderid),
      orderType: num(d.order_type),
      cancelable: num(d.cancelable),
      selPaytype: d.sel_paytype || '',
      supportedPayTypes: Array.isArray(d.supported_pay_types) ? d.supported_pay_types : [],
      inAppeal: appeal,
      appealText: d.appeal_verdict_has_open || '',
      reasonId: d.reason_id || '',
      reasonDesc: d.reason_desc || '',
      voucherUrls: Array.isArray(d.payment_voucher_url) ? d.payment_voucher_url : [],
    },
    _raw: d, // untouched Gate payload — shown by the modal's "Raw API data"
  };
}

/** "12.7~635" → { min: '12.7', max: '635' } */
function splitRange(s) {
  if (!s) return null;
  const m = String(s).split(/[~\-–]/).map(x => x.trim()).filter(Boolean);
  return m.length === 2 ? { min: m[0], max: m[1] } : null;
}
function parsePayTypeJson(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { const j = JSON.parse(s); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}

/**
 * my_ads_list row → the fields the ads tab shows. `names` (optional) maps
 * pay type → display name and payment id → account label, from the
 * merchant's own payment-method list.
 */
function normalizeAd(a, names = {}) {
  const fixed = Number(a.rate_fixed) === 1 || Number(a.rate_ref_id) <= 0;
  const payTypeJson = parsePayTypeJson(a.pay_type_json);
  const payTypes = Object.keys(payTypeJson);
  const limitFiat = splitRange(a.limit_fiat);
  const limitCrypto = splitRange(a.limit_total) || { min: a.min_amount, max: a.max_amount };
  const basis = a.limit_basis !== undefined ? Number(a.limit_basis) : (a.limitBasis !== undefined ? Number(a.limitBasis) : null);
  return {
    platform: 'gate',
    advNo: String(a.id ?? a.orderid ?? a.adv_no),
    side: String(a.type || '').toLowerCase() === 'buy' ? 'BUY' : 'SELL',
    priceType: fixed ? 1 : 2,
    price: a.rate,
    originalPrice: a.original_rate,
    floatRatio: fixed ? null : (a.rate_offset !== undefined ? String(a.rate_offset) : null),
    floatTrend: num(a.float_trend),
    rateRefId: num(a.rate_ref_id),
    availableAmount: a.amount,
    totalNumber: null,                        // Gate only reports the remaining amount
    lockedAmount: a.locked_amount,
    // Per-order limits. Gate stores them in crypto; `limit_fiat` is the
    // fiat equivalent at the current price (what the MEXC-style card shows).
    minAmount: limitFiat ? limitFiat.min : limitCrypto.min,
    maxAmount: limitFiat ? limitFiat.max : limitCrypto.max,
    limitBasis: basis,
    limitFiat, limitCrypto,
    fiatUnit: a.want_type || a.fiat_unit || 'IDR',
    coinName: a.currencyType || a.currency_type || a.asset || 'USDT',
    advStatus: String(a.status || '').toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSE',
    gateStatus: String(a.status || '').toUpperCase(),   // OPEN | OFFLIN | CLOSED | CANCEL
    paymentTimeLimit: num(a.expire_min),
    payTypes,
    payTypeJson,
    payMethodNames: payTypes.map(t => {
      const id = String(payTypeJson[t]);
      return names.byId?.[id] || names.byType?.[t] || t;
    }),
    hidePaymentInfo: num(a.hide_payment),
    tradeTerms: a.trade_tips || '',
    autoReplyMsg: a.auto_reply || '',
    inDispute: num(a.in_dispute),
    createTime: parseTime(a.timestamp),
    _gate: a,
  };
}

module.exports = {
  STATE_MAP, RUNNING_HOUSE, houseState, parseTime, paymentEntry, paymentsOfDetail, parsePayTypeJson, splitRange,
  normalizeListOrder, normalizeDetail, normalizeAd,
};

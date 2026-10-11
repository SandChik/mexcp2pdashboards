const { gatePost, okData, P } = require('./gateApi');
const A = require('./gateAdapter');
const { myPaymentMethods, fiatOf, assetOf, withMsg } = require('./gateOrders');

/**
 * Gate.io ad management — create, edit, quick price, list/delist/close.
 *
 * Contract with the browser is the dashboard's own shape (side 'SELL'|'BUY',
 * advNo as string); everything Gate-specific is translated here:
 *   - ONE endpoint for create AND edit (place_biz_push_order). `type` says
 *     which: 0 publish sell, 1 publish buy, 2 edit sell, 3 edit buy; an edit
 *     also carries `oid` (the ad id).
 *   - Payment methods: `payType` = comma-separated pay TYPES (bank, …) and
 *     `pay_type_json` = JSON string { type: <payment method id> } — i.e. one
 *     account per type, the same rule BingX enforces.
 *   - Per-order limits are either crypto (`limitBasis` 0: minAmount/maxAmount)
 *     or fiat (`limitBasis` 1: fiatMinAmount/fiatMaxAmount). The basis of an
 *     existing ad cannot be changed by an edit.
 *   - Status: ads_update_status adv_status 1 listed, 3 delisted, 4 closed.
 *     Close is final (a closed ad cannot be re-listed) → the dashboard's
 *     DELETE. OPEN/CLOSE toggle = 1/3.
 *   - No "modify price" call: the quick price box re-submits the ad with
 *     every field read back from ads_detail and only the price changed.
 *   - trade_tips / auto_reply go through Gate's off-platform-diversion risk
 *     check; a hit returns code 70305102 with the prompt in data.risk_event.
 */

const STATUS_TO_GATE = { OPEN: 1, LIST: 1, CLOSE: 3, DELIST: 3, DELETE: 4, CLOSED: 4 };
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
const s = v => (v === undefined || v === null ? undefined : String(v));
const numStr = (v, fallback) => (v === undefined || v === null || String(v).trim() === '' ? fallback : String(v).trim());

async function adDetail(m, advNo) {
  const res = await gatePost(P.AD_DETAIL, { adv_no: String(advNo) }, m.apiKey, m.apiSecret, { priority: true });
  return okData(res) || {};
}

/** { payType, pay_type_json } from the chosen payment-method ids, one per type. */
async function payFields(m, ids) {
  const chosen = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  if (chosen.length === 0) throw bad('Pilih minimal satu metode bayar');
  const mine = await myPaymentMethods(m);
  const map = {};
  for (const id of chosen) {
    const pm = mine.find(p => p.id === id);
    if (!pm) throw bad(`Metode bayar #${id} tidak ada di akun Gate ini — muat ulang daftar rekening`);
    if (map[pm.payType]) throw bad(`Gate hanya mengizinkan satu rekening per jenis (jenis "${pm.payName}" dipilih dua kali)`);
    map[pm.payType] = id;
  }
  return { payType: Object.keys(map).join(','), pay_type_json: JSON.stringify(map) };
}

/** Dashboard form → Gate parameters. */
async function buildParams(m, body, { creating }) {
  const side = body.side === 'BUY' ? 'BUY' : 'SELL';
  const p = {
    currencyType: assetOf(m),
    exchangeType: body.fiatUnit ? String(body.fiatUnit).toUpperCase() : fiatOf(m),
    type: creating ? (side === 'SELL' ? '0' : '1') : (side === 'SELL' ? '2' : '3'),
  };
  if (!creating) {
    if (!body.advNo) throw bad('advNo wajib untuk edit');
    p.oid = String(body.advNo);
  }

  // Price
  const priceType = Number(body.priceType) === 2 ? 2 : 1;
  if (priceType === 1) {
    const fp = numStr(body.fixedPrice);
    if (!fp || !(Number(fp) > 0)) throw bad('Harga tetap harus diisi');
    p.rateFixed = '1'; p.unitPrice = fp;
  } else {
    const fr = numStr(body.floatRatio);
    if (!fr || isNaN(Number(fr))) throw bad('Rasio mengambang (%) harus diisi');
    p.rateFixed = '0';
    p.rateReferenceId = numStr(body.rateReferenceId, '3');      // 1 platform, 2 Gate, 3 spot
    p.rateOffset = String(Math.abs(Number(fr)));
    p.float_trend = String(Number(body.floatTrend) === 1 ? 1 : 0); // 0 markup, 1 markdown
    // unitPrice is a required field even in floating mode: pass what the
    // form knows (current price) so the request validates.
    p.unitPrice = numStr(body.fixedPrice) || numStr(body.currentPrice) || '0';
  }

  // Amount
  const total = numStr(body.totalNumber);
  if (!total || !(Number(total) > 0)) throw bad(`Jumlah ${assetOf(m)} iklan harus diisi`);
  p.number = total;

  // Per-order limits
  const basis = Number(body.limitBasis) === 1 ? 1 : 0;
  p.limitBasis = basis;
  const min = Number(body.minAmount), max = Number(body.maxAmount);
  if (!(min > 0) || !(max > 0)) throw bad('Limit min & max harus diisi');
  if (min >= max) throw bad('Limit min harus lebih kecil dari max');
  if (basis === 1) { p.fiatMinAmount = String(body.minAmount); p.fiatMaxAmount = String(body.maxAmount); }
  else { p.minAmount = String(body.minAmount); p.maxAmount = String(body.maxAmount); }

  // Payment accounts
  Object.assign(p, await payFields(m, body.paymentIds));

  // Timeout + texts
  const em = Number(body.paymentTimeLimit);
  p.expire_min = String([15, 20, 30, 45, 60].includes(em) ? em : (em > 0 ? em : 20));
  if (body.tradeTerms !== undefined) p.trade_tips = String(body.tradeTerms);
  if (body.autoReplyMsg !== undefined) p.auto_reply = String(body.autoReplyMsg);

  // Counterparty conditions — Gate's "-1 / 0 = no limit" defaults
  const c = body.conditions || {};
  p.tierLimit = numStr(c.tierLimit, '0');
  p.verifiedLimit = numStr(c.verifiedLimit, '0');
  p.regTimeLimit = numStr(c.regTimeLimit, '0');
  p.advertisersLimit = Number(c.advertisersLimit) === 1 ? '1' : '0';
  p.polymarket_limit = Number(c.polymarketLimit) === 1 ? 1 : 0;
  p.min_completed_limit = numStr(c.minCompleted, '-1');
  p.max_completed_limit = numStr(c.maxCompleted, '-1');
  p.completed_rate_limit = numStr(c.completedRate, '-1');
  p.user_country_limit = numStr(c.userCountry, '-1');
  p.user_order_limit = numStr(c.userOrders, '-1');
  return p;
}

/** Surface Gate's risk-control rejection (70305102) as a readable message. */
function explain(res) {
  if (res && res.code === 70305102) {
    const ev = res.data?.risk_event || {};
    const hints = [res.data?.trade_tips, res.data?.auto_reply].filter(Boolean).join(' / ');
    return { ...res, msg: `Gate menolak teks iklan (risk control${res.data?.content_risk_type ? ': ' + res.data.content_risk_type : ''}): ${ev.msg || ev.title || hints || res.message || ''}` };
  }
  return withMsg(res);
}

/** Create (no advNo) or edit (advNo). Returns Gate's { code, msg, data }. */
async function saveAd(m, body) {
  const creating = !body.advNo;
  const params = await buildParams(m, body, { creating });
  return explain(await gatePost(P.AD_SAVE, params, m.apiKey, m.apiSecret, { priority: true }));
}

async function setStatus(m, advNo, status) {
  const code = typeof status === 'number' ? status : STATUS_TO_GATE[String(status).toUpperCase()];
  if (![1, 3, 4].includes(code)) throw bad('status harus OPEN, CLOSE, atau DELETE');
  const no = /^\d{1,15}$/.test(String(advNo)) ? Number(advNo) : String(advNo);
  return withMsg(await gatePost(P.AD_STATUS, { adv_no: no, adv_status: code }, m.apiKey, m.apiSecret, { priority: true }));
}

/** ads_detail → the edit payload with everything unchanged (then override the price). */
function paramsFromDetail(d, advNo) {
  const side = String(d.type || '').toLowerCase() === 'buy' ? 'BUY' : 'SELL';
  const payTypeJson = A.parsePayTypeJson(d.pay_type_json);
  const fixed = Number(d.rate_fixed) === 1 || Number(d.rate_ref_id) <= 0;
  const basis = Number(d.limit_basis) === 1 ? 1 : 0;
  const p = {
    currencyType: d.currency_type, exchangeType: d.want_type,
    type: side === 'SELL' ? '2' : '3', oid: String(d.orderid ?? advNo),
    unitPrice: s(d.rate), number: s(d.amount),
    rateFixed: fixed ? '1' : '0',
    payType: Object.keys(payTypeJson).join(','), pay_type_json: JSON.stringify(payTypeJson),
    limitBasis: basis,
    expire_min: s(d.expire_min ?? 20),
    trade_tips: d.trade_tips ?? '', auto_reply: d.auto_reply ?? '',
    tierLimit: s(d.tier_limit ?? 0), verifiedLimit: s(d.verified_limit ?? 0), regTimeLimit: s(d.reg_time_limit ?? 0),
    advertisersLimit: s(d.advertisers_limit ?? 0), polymarket_limit: Number(d.polymarket_limit) === 1 ? 1 : 0,
    min_completed_limit: s(d.min_completed_limit ?? -1), max_completed_limit: s(d.max_completed_limit ?? -1),
    completed_rate_limit: s(d.completed_rate_limit ?? -1), user_order_limit: s(d.user_orders_limit ?? -1),
    user_country_limit: '-1',
  };
  if (basis === 1) { p.fiatMinAmount = s(d.fiat_min_amount); p.fiatMaxAmount = s(d.fiat_max_amount); }
  else { p.minAmount = s(d.min_amount); p.maxAmount = s(d.max_amount); }
  if (!fixed) { p.rateReferenceId = s(d.rate_ref_id || 3); p.rateOffset = s(Math.abs(Number(d.rate_offset) || 0)); p.float_trend = s(d.float_trend ?? 0); }
  return p;
}

/** Quick price change = full edit with only the price fields replaced. */
async function setPrice(m, { advNo, priceType, fixedPrice, floatRatio, floatTrend }) {
  if (!advNo) throw bad('advNo wajib');
  const d = await adDetail(m, advNo);
  const p = paramsFromDetail(d, advNo);
  if (Number(priceType) === 2) {
    if (isNaN(Number(floatRatio))) throw bad('Rasio mengambang harus diisi');
    p.rateFixed = '0'; p.rateReferenceId = p.rateReferenceId || '3';
    p.rateOffset = String(Math.abs(Number(floatRatio)));
    if (floatTrend !== undefined) p.float_trend = String(Number(floatTrend) === 1 ? 1 : 0);
    else if (!p.float_trend) p.float_trend = '0';
  } else {
    if (!(Number(fixedPrice) > 0)) throw bad('Harga tetap harus diisi');
    p.rateFixed = '1'; p.unitPrice = String(fixedPrice);
    delete p.rateReferenceId; delete p.rateOffset; delete p.float_trend;
  }
  return explain(await gatePost(P.AD_SAVE, p, m.apiKey, m.apiSecret, { priority: true }));
}

module.exports = { adDetail, saveAd, setStatus, setPrice, buildParams, paramsFromDetail, STATUS_TO_GATE };

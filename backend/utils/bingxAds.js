const { bingxGet, bingxPost, P } = require('./bingxApi');
const A = require('./bingxAdapter');

/**
 * BingX ad management — create, edit, price, list/delist/delete, plus the two
 * lookups a form needs (allowed ranges, the merchant's own payment methods).
 *
 * Contract with the browser is the dashboard's own shape (side 'SELL'|'BUY',
 * advNo as string, arrays for lists); everything BingX-specific — tradeType
 * numbers, JSON-encoded string parameters, status codes — is translated here.
 *
 * Status codes, as VERIFIED on a live account (the PDF contradicts itself):
 *   myAdvert.status  0 = listed, 1 = delisted
 *   modifyStatus     0 = list,   1 = delist, 2 = delete
 */

const STATUS_TO_BINGX = { OPEN: 0, LIST: 0, CLOSE: 1, DELIST: 1, DELETE: 2 };
const PAY_TIME = { 15: 1, 30: 2, 45: 3, 60: 4 };
// The PDF says sell ads ≤3, buy ads ≤5. The live BingX UI allows 5 on sell ads
// (verified by the operator, 8 Sep 2026) — the exchange is the authority.
const MAX_METHODS = { SELL: 5, BUY: 5 };
const CONDITIONS = new Set(['registryCountryCode', 'registryDays', 'latestSuccessOrderCount', 'latestSuccessAppealCount', 'isBindPhone', 'isTradeSpotOrStdContract']);

function okData(res) {
  if (!res || res.code !== 0) { const e = new Error(`BingX ${res?.code ?? '?'}: ${res?.msg || 'unknown error'}`); e.bingx = res; throw e; }
  return res.data;
}
const resultOf = d => (Array.isArray(d?.result) ? d.result : (Array.isArray(d) ? d : []));
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };

/** Allowed price / amount ranges + market price for a fiat & side. */
async function assetConfig(m, { asset = 'USDT', fiatUnit = 'IDR', tradeType = 2 } = {}) {
  const res = await bingxGet(P.ASSET_CONFIG, { asset, fiatUnit, tradeType: Number(tradeType) }, m.apiKey, m.apiSecret, { priority: true });
  return okData(res);
}

/** The merchant's saved receiving accounts, flattened for a picker. */
async function myPaymentMethods(m) {
  const res = await bingxGet(P.MY_PAYMENT_METHODS, {}, m.apiKey, m.apiSecret, { priority: true });
  return resultOf(okData(res)).map(pm => {
    const f = A.flattenFields(pm.fields);
    return {
      userPaymentMethodId: pm.userPaymentMethodId,
      methodId: pm.id,
      name: pm.name,
      account: f.account,
      payee: f.payee,
      summary: f.all,
    };
  });
}

/** Dashboard form → BingX parameters shared by add and modify. */
function buildParams(body, { creating }) {
  const side = body.side === 'BUY' ? 'BUY' : 'SELL';
  const priceType = Number(body.priceType) === 2 ? 2 : 1;
  const p = { priceType };

  if (priceType === 1) {
    const fp = String(body.fixedPrice ?? '').trim();
    if (!fp || isNaN(Number(fp)) || Number(fp) <= 0) throw bad('Harga tetap harus diisi');
    p.fixedPrice = fp;
  } else {
    const fr = String(body.floatRatio ?? '').trim();
    if (!fr || isNaN(Number(fr)) || Number(fr) <= 0) throw bad('Rasio mengambang (%) harus diisi');
    p.floatRatio = fr;
  }

  const total = String(body.totalNumber ?? '').trim();
  if (!total || isNaN(Number(total)) || Number(total) <= 0) throw bad('Total USDT harus diisi');
  p.totalNumber = total;

  const min = Number(body.minAmount), max = Number(body.maxAmount);
  if (!(min > 0) || !(max > 0)) throw bad('Limit min & max harus diisi');
  if (min >= max) throw bad('Limit min harus lebih kecil dari max');
  p.minAmount = String(body.minAmount); p.maxAmount = String(body.maxAmount);

  const ptl = Number(body.paymentTimeLimit);
  p.paymentTimeLimit = [1, 2, 3, 4].includes(ptl) ? ptl : (PAY_TIME[ptl] || 1);

  const methods = (Array.isArray(body.userPaymentMethods) ? body.userPaymentMethods : [])
    .map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (methods.length === 0) throw bad('Pilih minimal satu metode bayar');
  if (methods.length > MAX_METHODS[side]) throw bad(`Maksimal ${MAX_METHODS[side]} metode bayar untuk iklan ${side === 'SELL' ? 'jual' : 'beli'}`);
  if (Array.isArray(body._methodTypes)) {
    // { userPaymentMethodId: methodId } supplied by the form — one account per type (BingX 100400)
    const seen = new Map();
    for (const id of methods) {
      const t = body._methodTypes.find(x => Number(x.userPaymentMethodId) === id)?.methodId;
      if (t === undefined) continue;
      if (seen.has(t)) throw bad(`BingX hanya mengizinkan satu rekening per jenis (jenis #${t} dipilih dua kali)`);
      seen.set(t, id);
    }
  }
  p.userPaymentMethods = JSON.stringify(methods); // BingX wants the list as a JSON STRING (verified in the PDF examples)

  const conds = (Array.isArray(body.userMatchConditions) ? body.userMatchConditions : [])
    .filter(c => c && CONDITIONS.has(c.conditionName) && c.conditionValue !== undefined && c.conditionValue !== null && String(c.conditionValue) !== '')
    .map(c => ({ conditionName: c.conditionName, conditionValue: String(c.conditionValue) }));
  p.userMatchConditions = JSON.stringify(conds);

  if (body.termsDesc !== undefined) p.termsDesc = String(body.termsDesc);
  if (body.autoReplyMsg !== undefined) p.autoReplyMsg = String(body.autoReplyMsg);
  if (side === 'SELL') p.hidePaymentInfo = Number(body.hidePaymentInfo) === 1 ? 1 : 0;

  if (creating) {
    p.asset = body.asset || 'USDT';
    p.fiatUnit = body.fiatUnit || 'IDR';
    p.tradeType = side === 'BUY' ? 1 : 2;
  } else {
    if (!body.advNo) throw bad('advNo wajib untuk edit');
    p.advertNo = String(body.advNo);
    if (body.availableAmount !== undefined && String(body.availableAmount).trim() !== '') p.availableAmount = String(body.availableAmount);
  }
  return p;
}

/** Create (no advNo) or edit (advNo) an ad. Returns BingX's { code, msg, data }. */
async function saveAd(m, body) {
  const creating = !body.advNo;
  const params = buildParams(body, { creating });
  return bingxPost(creating ? P.ADVERT_ADD : P.ADVERT_MODIFY, params, m.apiKey, m.apiSecret, { priority: true });
}

async function setStatus(m, advNo, status) {
  const code = typeof status === 'number' ? status : STATUS_TO_BINGX[String(status).toUpperCase()];
  if (![0, 1, 2].includes(code)) throw bad('status harus OPEN, CLOSE, atau DELETE');
  return bingxPost(P.ADVERT_STATUS, { advertNo: String(advNo), status: code }, m.apiKey, m.apiSecret, { priority: true });
}

async function setPrice(m, { advNo, priceType, fixedPrice, floatRatio }) {
  const pt = Number(priceType) === 2 ? 2 : 1;
  const params = { advertNo: String(advNo), priceType: pt };
  if (pt === 1) {
    if (!(Number(fixedPrice) > 0)) throw bad('Harga tetap harus diisi');
    params.fixedPrice = String(fixedPrice);
  } else {
    if (!(Number(floatRatio) > 0)) throw bad('Rasio mengambang harus diisi');
    params.floatRatio = String(floatRatio);
  }
  return bingxPost(P.ADVERT_PRICE, params, m.apiKey, m.apiSecret, { priority: true });
}

module.exports = { assetConfig, myPaymentMethods, saveAd, setStatus, setPrice, buildParams, STATUS_TO_BINGX };

const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/authMiddleware');
const { mexcGet, mexcPost } = require('../utils/mexcApi');

const { getMerchant } = require('../utils/store');
const { audit } = require('../utils/audit');
const bx = require('../utils/bingxOrders');
const bxAds = require('../utils/bingxAds');
const router = express.Router();

// Uniform error reply for BingX paths: validation errors are 400 with the
// message, upstream errors keep BingX's own code/msg so the true reason shows.
function bingxFail(res, err) {
  const d = err.bingx || err.response?.data;
  const status = err.status || 500;
  return res.status(status).json({ code: d?.code ?? -1, msg: d?.msg || err.message, error: d?.msg || err.message });
}

const KYC_INT_TO_STR = { 0: 'NONE', 1: 'PRIMARY', 2: 'ADVANCED' };

function resolveKycLevel(val) {
  if (typeof val === 'number') return KYC_INT_TO_STR[val] || 'PRIMARY';
  if (typeof val === 'string' && ['NONE','PRIMARY','ADVANCED'].includes(val.toUpperCase())) return val.toUpperCase();
  return 'PRIMARY';
}

function resolvePayMethod(body) {
  // Use paymentInfo IDs (user-level) if available — most accurate
  if (Array.isArray(body.paymentInfo) && body.paymentInfo.length > 0) {
    return body.paymentInfo.map(p => p.id).join(',');
  }
  // Fallback to payMethod field
  return body.payMethod || '';
}

// Include a field only if it actually has a value. Non-ASCII is now fine:
// signature.js signs the raw string and sends URL-encoded, matching MEXC's
// reference, so Indonesian auto-reply / trade-terms text works correctly.
function hasValue(v) {
  return !(v === undefined || v === null || v === '');
}

async function fetchAllAds(params, apiKey, apiSecret) {
  let all = [];
  for (const status of ['OPEN', 'CLOSE', 'LOW_STOCK']) {
    let page = 1;
    while (page <= 20) {
      const result = await mexcGet('/api/v3/fiat/merchant/ads/pagination',
        { ...params, advStatus: status, page, limit: 10 }, apiKey, apiSecret);
      const items = Array.isArray(result.data) ? result.data : [];
      if (items.length === 0) break;
      all = [...all, ...items];
      if (page >= (result.page?.totalPage || 1)) break;
      page++;
    }
  }
  return all;
}

// GET /api/ads/:merchantId
router.get('/:merchantId', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (bx.isBingx(merchant)) {
    try { return res.json({ code: 0, data: await bx.listAds(merchant) }); }
    catch (err) { return res.status(500).json({ code: -1, error: err.message }); }
  }
  try {
    const all = await fetchAllAds({}, merchant.apiKey, merchant.apiSecret);
    res.json({ code: 0, msg: 'success', data: all });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ads/:merchantId/market
router.get('/:merchantId/market', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (bx.isBingx(merchant)) {
    try { return res.json({ code: 0, data: await bx.marketAds(merchant, req.query) }); }
    catch (err) { return res.status(500).json({ code: -1, error: err.message }); }
  }
  try {
    const { fiatUnit, coinId, side, page = 1 } = req.query;
    const result = await mexcGet('/api/v3/fiat/market/ads/pagination',
      { fiatUnit, coinId, side, page }, merchant.apiKey, merchant.apiSecret);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ads/:merchantId — create or update
router.post('/:merchantId', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (bx.isBingx(merchant)) {
    try {
      const result = await bxAds.saveAd(merchant, req.body);
      audit({ action: req.body.advNo ? 'ad_save' : 'ad_create', platform: 'bingx', merchantId: merchant.id, merchantName: merchant.name, advNo: req.body.advNo || result?.data?.advertNo, side: req.body.side, price: req.body.fixedPrice || `${req.body.floatRatio}%`, code: result?.code, msg: result?.msg });
      return res.json(result);
    } catch (err) { return bingxFail(res, err); }
  }
  try {
    const result = await mexcPost('/api/v3/fiat/merchant/ads/save_or_update',
      req.body, merchant.apiKey, merchant.apiSecret, { priority: true });
    audit({ action: 'ad_save', merchantId: merchant.id, merchantName: merchant.name, advNo: req.body.advNo, side: req.body.side, price: req.body.price, code: result?.code, msg: result?.msg });
    res.json(result);
  } catch (err) {
    const d = err.response?.data;
    res.status(500).json({ code: d?.code || -1, msg: d?.msg || err.message, error: d?.msg || err.message });
  }
});

// POST /api/ads/:merchantId/toggle-status
router.post('/:merchantId/toggle-status', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (bx.isBingx(merchant)) {
    // BingX: one call, one field. advStatus OPEN → list, CLOSE → delist, DELETE → delete (irreversible).
    try {
      const result = await bxAds.setStatus(merchant, req.body.advNo, req.body.advStatus);
      audit({ action: req.body.advStatus === 'DELETE' ? 'ad_delete' : 'ad_toggle', platform: 'bingx', merchantId: merchant.id, merchantName: merchant.name, advNo: req.body.advNo, to: req.body.advStatus, code: result?.code, msg: result?.msg });
      return res.json(result);
    } catch (err) { return bingxFail(res, err); }
  }

  try {
    const b = req.body;

    // Toggle status only:
    // - initQuantity is required by MEXC; use the ad's current availableQuantity (clamped to 100-150000)
    //   This is idempotent: if initQuantity "sets" the value, current=available so no change
    // - supplyQuantity NOT sent (we don't want to add stock from wallet)
    const availQty = parseFloat(b.availableQuantity) || 0;
    const initQty  = availQty > 0
      ? Math.min(Math.max(availQty, 100), 150000)  // clamp to valid range
      : 100;

    const params = {
      advNo:                b.advNo,
      advStatus:            b.advStatus,
      side:                 b.side,
      fiatUnit:             b.fiatUnit,
      coinId:               b.coinId,
      price:                Number(b.price),
      initQuantity:         initQty,        // current availableQuantity (clamped)
      minSingleTransAmount: Number(b.minSingleTransAmount),
      maxSingleTransAmount: Number(b.maxSingleTransAmount),
      payMethod:            resolvePayMethod(b),
      payTimeLimit:         Number(b.payTimeLimit) || 15,
      kycLevel:             b.kycLevel === 'ADVANCED' || b.kycLevel === 2 ? 'ADVANCED' : 'PRIMARY',
      priceType:            b.priceType !== undefined ? Number(b.priceType) : 0,
      allowSys:             b.allowSys !== undefined ? Boolean(b.allowSys) : true,
      requireMobile:        b.requireMobile !== undefined ? Boolean(b.requireMobile) : false,
      userAllTradeCountMin: Number(b.userAllTradeCountMin) || 0,
      userAllTradeCountMax: Number(b.userAllTradeCountMax) || 0,
    };

    // Pass optional string fields through whenever present (non-ASCII OK now)
    if (hasValue(b.countryCode))  params.countryCode  = b.countryCode;
    if (hasValue(b.autoReplyMsg)) params.autoReplyMsg = b.autoReplyMsg;
    if (hasValue(b.tradeTerms))   params.tradeTerms   = b.tradeTerms;

    // Optional numeric/bool fields
    if (Number(b.buyerRegDaysLimit) > 0) params.buyerRegDaysLimit = Number(b.buyerRegDaysLimit);
    if (Number(b.maxPayLimit)       > 0) params.maxPayLimit       = Number(b.maxPayLimit);
    if (Number(b.exchangeCount)     > 0) params.exchangeCount     = Number(b.exchangeCount);
    if (b.blockTrade === true || b.blockTrade === 'true') params.blockTrade = true;

    console.log('[toggle] merchant:', merchant.name, 'params:', JSON.stringify(params));

    const result = await mexcPost('/api/v3/fiat/merchant/ads/save_or_update',
      params, merchant.apiKey, merchant.apiSecret, { priority: true });

    console.log('[toggle] result:', JSON.stringify(result));
    audit({ action: 'ad_toggle', merchantId: merchant.id, merchantName: merchant.name, advNo: params.advNo, to: params.advStatus, code: result?.code, msg: result?.msg });

    // Only the specific frequency codes are a real cooldown. Everything else
    // keeps MEXC's actual message so the true reason is visible.
    if (result.code === 30014 || result.code === 30020) {
      result.cooldown = true;
    }
    res.json(result);
  } catch (err) {
    const d = err.response?.data;
    console.error('[toggle] error:', d || err.message);
    res.status(500).json({ code: d?.code || -1, msg: d?.msg || err.message, error: d?.msg || err.message });
  }
});

// ── BingX-only ───────────────────────────────────────────────────────
// POST /api/ads/:merchantId/price — quick price change (modifyPrice)
router.post('/:merchantId/price', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!bx.isBingx(merchant)) return res.status(400).json({ code: -1, msg: 'Hanya untuk merchant BingX' });
  try {
    const result = await bxAds.setPrice(merchant, req.body);
    audit({ action: 'ad_price', platform: 'bingx', merchantId: merchant.id, merchantName: merchant.name, advNo: req.body.advNo, price: req.body.fixedPrice || `${req.body.floatRatio}%`, code: result?.code, msg: result?.msg });
    res.json(result);
  } catch (err) { bingxFail(res, err); }
});

// GET /api/ads/:merchantId/config?fiatUnit=IDR&tradeType=2 — allowed ranges + market price
router.get('/:merchantId/config', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!bx.isBingx(merchant)) return res.status(400).json({ code: -1, msg: 'Hanya untuk merchant BingX' });
  try { res.json({ code: 0, data: await bxAds.assetConfig(merchant, req.query) }); }
  catch (err) { bingxFail(res, err); }
});

// GET /api/ads/:merchantId/payment-methods — the merchant's own receiving accounts
router.get('/:merchantId/payment-methods', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!bx.isBingx(merchant)) return res.status(400).json({ code: -1, msg: 'Hanya untuk merchant BingX' });
  try { res.json({ code: 0, data: await bxAds.myPaymentMethods(merchant) }); }
  catch (err) { bingxFail(res, err); }
});

module.exports = router;

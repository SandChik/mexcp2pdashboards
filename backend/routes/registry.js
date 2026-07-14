const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/authMiddleware');
const { captureBuyerLog } = require('../utils/captureCore');
const { getMerchant } = require('../utils/store');
const { audit } = require('../utils/audit');

const router = express.Router();

// Permanent buyer log. One record per completed order:
// { [advOrderNo]: { merchantId, realName, nickName, memberId, doneAt, amount, usdt, fiatUnit, addedAt } }
const LOG_PATH = path.join(__dirname, '../data/buyer-log.json');
// member-ids already caches order-detail lookups here — reuse it so the same
// order is never fetched from MEXC twice across features.
const UU_CACHE = path.join(__dirname, '../data/uu-cache.json');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function writeJson(p, o) { try { fs.writeFileSync(p, JSON.stringify(o, null, 2)); } catch {} }

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// POST /api/registry/:mid/capture — record completed orders into the log.
// Body: { orders: [{ advOrderNo, amount, usdt, fiatUnit, doneAt }] }
// Shared logic with the 24/7 worker lives in utils/captureCore (locked writes).
router.post('/:mid/capture', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.mid);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  const orders = Array.isArray(req.body.orders) ? req.body.orders : [];
  const { added, fetched } = await captureBuyerLog(merchant, orders);
  if (added) audit({ action: 'buyer_log_capture', merchantId: merchant.id, merchantName: merchant.name, added });
  res.json({ added, fetched });
});

// GET /api/registry/:mid — records for one merchant (or ?all=true for every
// merchant) + duplicate-name index. Duplicates are computed on normalized
// realName; entries without a realName can't participate in matching.
router.get('/:mid', authMiddleware, (req, res) => {
  const log = readJson(LOG_PATH);
  const all = req.query.all === 'true';
  const records = Object.entries(log)
    .filter(([, r]) => all || r.merchantId === req.params.mid)
    .map(([advOrderNo, r]) => ({ advOrderNo, ...r }))
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  const nameIndex = {}; // normName -> [advOrderNo]
  for (const r of records) {
    if (!r.realName) continue;
    const k = normName(r.realName);
    (nameIndex[k] = nameIndex[k] || []).push(r.advOrderNo);
  }
  res.json({ records, nameIndex });
});

// DELETE /api/registry/:mid/:advOrderNo — remove one record (e.g. false entry)
router.delete('/:mid/:advOrderNo', authMiddleware, (req, res) => {
  const log = readJson(LOG_PATH);
  const rec = log[req.params.advOrderNo];
  if (!rec || rec.merchantId !== req.params.mid) return res.status(404).json({ error: 'Record not found' });
  delete log[req.params.advOrderNo];
  writeJson(LOG_PATH, log);
  audit({ action: 'buyer_log_delete', merchantId: req.params.mid, advOrderNo: req.params.advOrderNo });
  res.json({ success: true });
});

module.exports = router;

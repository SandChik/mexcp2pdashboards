const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const { mexcGet, mexcPost } = require('../utils/mexcApi');
const { readConfig, writeConfig, getMerchant, encryptSecret, decryptSecret } = require('../utils/store');
const { audit } = require('../utils/audit');
const fs = require('fs');
const path = require('path');

const PAUSE_PATH = path.join(__dirname, '../data/paused.json');
function readPause() { try { return JSON.parse(fs.readFileSync(PAUSE_PATH, 'utf8')); } catch { return {}; } }
function writePause(o) { fs.writeFileSync(PAUSE_PATH, JSON.stringify(o, null, 2)); }

const SETTINGS_PATH = path.join(__dirname, '../data/merchant-settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; } }
function writeSettings(o) { try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(o, null, 2)); } catch {} }
// Per-merchant dashboard settings. buyerLog replaces the old realNameAlert:
// when ON, every completed order's buyer is recorded permanently and duplicate
// KYC names raise an alert. Auto-reply rules & quick replies are ALSO stored
// here so each merchant has its own message set (no longer global/localStorage).
const DEFAULT_QUICK = [
  'Dana sudah kami terima, pesanan sedang diproses ya kak \ud83d\ude4f',
  'Mohon kirim bukti transfernya ya kak',
  'Berita / catatan transfer WAJIB dikosongkan ya kak',
  'Pesanan selesai, terima kasih! Mohon review positifnya ya kak \ud83d\ude4f',
];
const DEFAULT_RULES = [
  { id: 'sellUnpaid', side: 'SELL', state: 0, message: 'Halo kak \ud83d\udc4b Pesanan sudah kami terima. Silakan lanjut ke proses pembayaran ya, lalu kirim bukti transfernya. Terima kasih \ud83d\ude4f' },
  { id: 'sellDone', side: 'SELL', state: 4, message: 'Pesanan selesai \ud83c\udf89 Terima kasih sudah bertransaksi, kak. Jika berkenan, mohon tinggalkan review positif ya \ud83d\ude4f' },
  { id: 'buyUnpaid', side: 'BUY', state: 0, message: 'Halo kak \ud83d\udc4b Pembayaran sedang kami proses, mohon ditunggu sebentar ya. Terima kasih \ud83d\ude4f' },
  { id: 'buyPaid', side: 'BUY', state: 1, message: 'Transfer sudah kami lakukan \u2705 Mohon dicek dan segera release koinnya ya kak. Terima kasih \ud83d\ude4f' },
  { id: 'buyDone', side: 'BUY', state: 4, message: 'Pesanan selesai \ud83c\udf89 Terima kasih sudah bertransaksi, kak. Jika berkenan, mohon tinggalkan review positif ya \ud83d\ude4f' },
];
const DEFAULT_SETTINGS = { buyerLog: false, autoReplyEnabled: true, autoReplyRules: DEFAULT_RULES, quickReplies: DEFAULT_QUICK };

const router = express.Router();

// GET /api/merchants — list (secret never leaves the server in the clear)
router.get('/', authMiddleware, (req, res) => {
  const config = readConfig();
  const safe = config.merchants.map(m => {
    const plain = decryptSecret(m.apiSecret);
    return {
      id: m.id, name: m.name, apiKey: m.apiKey,
      apiSecret: plain ? '••••••••' + plain.slice(-4) : '',
      apiSecretSet: !!m.apiSecret,
    };
  });
  res.json(safe);
});

// POST /api/merchants — add
router.post('/', authMiddleware, (req, res) => {
  const { name, apiKey, apiSecret } = req.body;
  if (!name || !apiKey || !apiSecret) return res.status(400).json({ error: 'name, apiKey, apiSecret required' });

  const config = readConfig();
  if (config.merchants.length >= 5) return res.status(400).json({ error: 'Maximum 5 merchants allowed' });

  const merchant = { id: Date.now().toString(), name, apiKey, apiSecret: encryptSecret(apiSecret) };
  config.merchants.push(merchant);
  writeConfig(config);
  res.json({ success: true, merchant: { id: merchant.id, name, apiKey } });
});

// PUT /api/merchants/:id — update
router.put('/:id', authMiddleware, (req, res) => {
  const { name, apiKey, apiSecret } = req.body;
  const config = readConfig();
  const idx = config.merchants.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Merchant not found' });

  config.merchants[idx] = {
    ...config.merchants[idx],
    ...(name && { name }),
    ...(apiKey && { apiKey }),
    ...(apiSecret && { apiSecret: encryptSecret(apiSecret) }),
  };
  writeConfig(config);
  res.json({ success: true });
});

// DELETE /api/merchants/:id
router.delete('/:id', authMiddleware, (req, res) => {
  const config = readConfig();
  config.merchants = config.merchants.filter(m => m.id !== req.params.id);
  writeConfig(config);
  res.json({ success: true });
});

// POST /api/merchants/:id/service-switch — open/close merchant
router.post('/:id/service-switch', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  try {
    const result = await mexcPost('/api/v3/fiat/merchant/service/switch',
      { open: req.body.open }, merchant.apiKey, merchant.apiSecret, { priority: true });
    audit({ action: 'service_switch', merchantId: merchant.id, merchantName: merchant.name, open: req.body.open, code: result?.code, msg: result?.msg });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/merchants/:id/balance — USDT spot balance
router.get('/:id/balance', authMiddleware, async (req, res) => {
  const merchant = getMerchant(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  try {
    const result = await mexcGet('/api/v3/account', {}, merchant.apiKey, merchant.apiSecret, { priority: true });
    const usdt = (result.balances || []).find(b => b.asset === 'USDT');
    res.json({ free: usdt?.free || '0', locked: usdt?.locked || '0' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/merchants/:id/pause-state — which ads were closed by a Pause action
router.get('/:id/pause-state', authMiddleware, (req, res) => {
  const entry = readPause()[req.params.id];
  res.json(entry || { paused: false, ads: [] });
});

// POST /api/merchants/:id/pause-state — persist the snapshot (survives restart)
router.post('/:id/pause-state', authMiddleware, (req, res) => {
  const all = readPause();
  const prev = all[req.params.id];
  const stillPaused = !!req.body.paused;
  const pausedAt = stillPaused ? (prev && prev.paused && prev.pausedAt ? prev.pausedAt : Date.now()) : null;
  all[req.params.id] = { paused: stillPaused, ads: Array.isArray(req.body.ads) ? req.body.ads : [], pausedAt };
  writePause(all);
  audit({ action: req.body.paused ? 'trading_pause' : 'trading_resume', merchantId: req.params.id, adCount: (req.body.ads || []).length });
  res.json({ success: true });
});

// GET /api/merchants/:id/settings — per-merchant dashboard settings
router.get('/:id/settings', authMiddleware, (req, res) => {
  res.json({ ...DEFAULT_SETTINGS, ...(readSettings()[req.params.id] || {}) });
});

// POST /api/merchants/:id/settings — update per-merchant settings
router.post('/:id/settings', authMiddleware, (req, res) => {
  const all = readSettings();
  all[req.params.id] = { ...DEFAULT_SETTINGS, ...(all[req.params.id] || {}), ...req.body };
  writeSettings(all);
  res.json({ success: true, settings: all[req.params.id] });
});

module.exports = router;

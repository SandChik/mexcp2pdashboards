const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const notifier = require('../utils/notifier');
const router = express.Router();

// GET /api/notify — everything the settings screen needs
router.get('/', authMiddleware, (req, res) => {
  let watcher = null;
  try { watcher = require('../utils/orderWatcher').status(); } catch { /* not started */ }
  res.json({ ...notifier.status(), watcher });
});

// POST /api/notify/settings — { events?, telegram? }
router.post('/settings', authMiddleware, (req, res) => {
  const patch = {};
  if (req.body.events && typeof req.body.events === 'object') patch.events = req.body.events;
  if (req.body.telegram && typeof req.body.telegram === 'object') {
    const t = req.body.telegram; patch.telegram = {};
    if (typeof t.enabled === 'boolean') patch.telegram.enabled = t.enabled;
    if (typeof t.chatId === 'string') patch.telegram.chatId = t.chatId.trim();
    // A masked token (from publicSettings) must never overwrite the real one.
    if (typeof t.botToken === 'string' && t.botToken && !t.botToken.includes('…')) patch.telegram.botToken = t.botToken.trim();
  }
  notifier.saveSettings(patch);
  res.json({ success: true, settings: notifier.publicSettings() });
});

// POST /api/notify/subscribe — { subscription, label }
router.post('/subscribe', authMiddleware, (req, res) => {
  const sub = req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'subscription tidak valid' });
  const rec = notifier.addSub(sub, { ua: String(req.headers['user-agent'] || '').slice(0, 120), label: String(req.body.label || '').slice(0, 60) });
  res.json({ success: true, id: rec.id });
});
router.post('/unsubscribe', authMiddleware, (req, res) => {
  const removed = notifier.removeSub(req.body.endpoint || req.body.id);
  res.json({ success: true, removed });
});

// POST /api/notify/test — fire a test to every channel
router.post('/test', authMiddleware, async (req, res) => {
  res.json(await notifier.testAll());
});

// POST /api/notify/telegram/detect — { botToken? } → chat id of whoever messaged the bot last
router.post('/telegram/detect', authMiddleware, async (req, res) => {
  const t = req.body.botToken;
  res.json(await notifier.telegramDetectChat(t && !String(t).includes('…') ? String(t).trim() : undefined));
});
// POST /api/notify/telegram/test — { botToken?, chatId? } (unsaved values allowed)
router.post('/telegram/test', authMiddleware, async (req, res) => {
  const t = req.body.botToken, c = req.body.chatId;
  res.json(await notifier.telegramSend('🔔 <b>Tes Telegram</b> — SandChik P2P bisa mengirim ke chat ini.', { botToken: t && !String(t).includes('…') ? String(t).trim() : undefined, chatId: c ? String(c).trim() : undefined }));
});

module.exports = router;

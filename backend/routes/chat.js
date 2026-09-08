const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const { authMiddleware } = require('../middleware/authMiddleware');
const { mexcGet, mexcPost } = require('../utils/mexcApi');
const { buildSignedParams } = require('../utils/signature');
const wsManager = require('../utils/wsManager');
const bx = require('../utils/bingxOrders');
const bxChat = require('../utils/bingxChat');
const bxErr = (res, e) => res.status(500).json({ error: e.bingx?.msg || e.message, code: e.bingx?.code ?? -1 });

const router = express.Router();
const { getMerchant } = require('../utils/store');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET conversation ID for an order
router.get('/:mid/conversation/:orderNo', authMiddleware, async (req, res) => {
  const m = getMerchant(req.params.mid);
  if (!m) return res.status(404).json({ error: 'Merchant not found' });
  // BingX: the chat room IS the order — the order number doubles as the conversation id.
  if (bx.isBingx(m)) return res.json({ code: 0, data: { conversationId: String(req.params.orderNo) } });
  try {
    const r = await mexcGet('/api/v3/fiat/retrieveChatConversation', { orderNo: req.params.orderNo }, m.apiKey, m.apiSecret, { priority: true });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET message history (source of truth — use this for display)
router.get('/:mid/messages/:cid', authMiddleware, async (req, res) => {
  const m = getMerchant(req.params.mid);
  if (!m) return res.status(404).json({ error: 'Merchant not found' });
  if (bx.isBingx(m)) {
    try { return res.json({ code: 0, data: { messages: await bxChat.history(m, req.params.cid, req.query.limit) } }); }
    catch (e) { return bxErr(res, e); }
  }
  try {
    const { page = 1, limit = 50, sort = 'ASC' } = req.query;
    const r = await mexcGet(
      '/api/v3/fiat/retrieveChatMessageWithPagination',
      { conversationId: req.params.cid, page, limit, sort },
      m.apiKey, m.apiSecret
    );
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST connect WS
router.post('/:mid/connect/:cid', authMiddleware, async (req, res) => {
  const m = getMerchant(req.params.mid);
  if (!m) return res.status(404).json({ error: 'Merchant not found' });
  if (bx.isBingx(m)) return res.json({ success: true, mode: 'polling' }); // no socket to open — the browser polls history
  try {
    const lk = await mexcPost('/api/v3/userDataStream', {}, m.apiKey, m.apiSecret);
    if (!lk.listenKey) return res.status(500).json({ error: 'Failed to get listenKey' });
    // Refresher lets wsManager fetch a fresh listenKey before the 1h expiry.
    const refresher = async () => {
      const f = await mexcPost('/api/v3/userDataStream', {}, m.apiKey, m.apiSecret);
      return f.listenKey;
    };
    const r = await wsManager.connect(req.params.mid, req.params.cid, lk.listenKey, refresher);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST send text message
router.post('/:mid/send', authMiddleware, async (req, res) => {
  const { conversationId, content } = req.body;
  if (!conversationId || !content) return res.status(400).json({ error: 'conversationId and content required' });
  const m = getMerchant(req.params.mid);
  if (bx.isBingx(m)) {
    try { return res.json(await bxChat.sendText(m, conversationId, content)); }
    catch (e) { return res.json({ success: false, error: e.bingx?.msg || e.message }); }
  }
  res.json(wsManager.send(req.params.mid, conversationId, content));
});

// POST send image message
router.post('/:mid/send-image', authMiddleware, async (req, res) => {
  const { conversationId, imageUrl, imageThumbUrl } = req.body;
  if (!conversationId || !imageUrl) return res.status(400).json({ error: 'conversationId and imageUrl required' });
  const m = getMerchant(req.params.mid);
  if (bx.isBingx(m)) {
    try { return res.json(await bxChat.sendImage(m, conversationId, imageUrl)); }
    catch (e) { return res.json({ success: false, error: e.bingx?.msg || e.message }); }
  }
  res.json(wsManager.sendImage(req.params.mid, conversationId, imageUrl, imageThumbUrl));
});

// GET status
router.get('/:mid/status/:cid', authMiddleware, (req, res) => {
  const m = getMerchant(req.params.mid);
  if (bx.isBingx(m)) return res.json({ status: 'connected', mode: 'polling' });
  res.json({ status: wsManager.status(req.params.mid, req.params.cid) });
});

// DELETE disconnect
router.delete('/:mid/disconnect/:cid', authMiddleware, (req, res) => {
  wsManager.disconnect(req.params.mid, req.params.cid);
  res.json({ success: true });
});

// POST upload file/image for chat
router.post('/:mid/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const m = getMerchant(req.params.mid);
  if (!m) return res.status(404).json({ error: 'Merchant not found' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  if (bx.isBingx(m)) {
    try { return res.json(await bxChat.upload(m, req.file.buffer, req.file.originalname, req.file.mimetype)); }
    catch (e) { return res.status(500).json({ code: -1, msg: e.bingx?.msg || e.message, error: e.bingx?.msg || e.message }); }
  }

  try {
    const { queryString: qs, signature } = buildSignedParams({}, m.apiSecret);
    const qsFull = qs + '&signature=' + signature;

    const form = new FormData();
    form.append('file', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });

    const r = await axios.post(`https://api.mexc.com/api/v3/fiat/uploadFile?${qsFull}`, form, {
      headers: { 'x-mexc-apikey': m.apiKey, ...form.getHeaders() }
    });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.msg || e.message });
  }
});

// GET download file (proxy to avoid CORS)
router.get('/:mid/download/:fileId', authMiddleware, async (req, res) => {
  const m = getMerchant(req.params.mid);
  if (!m) return res.status(404).json({ error: 'Merchant not found' });
  if (bx.isBingx(m)) return res.json(bxChat.download(req.params.fileId));
  try {
    const r = await mexcGet('/api/v3/fiat/downloadFile', { fileId: req.params.fileId }, m.apiKey, m.apiSecret);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

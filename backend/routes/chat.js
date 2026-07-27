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

const router = express.Router();
const { getMerchant } = require('../utils/store');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET conversation ID for an order
router.get('/:mid/conversation/:orderNo', authMiddleware, async (req, res) => {
  const m = getMerchant(req.params.mid);
  if (!m) return res.status(404).json({ error: 'Merchant not found' });
  try {
    const r = await mexcGet('/api/v3/fiat/retrieveChatConversation', { orderNo: req.params.orderNo }, m.apiKey, m.apiSecret, { priority: true });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET message history (source of truth — use this for display)
router.get('/:mid/messages/:cid', authMiddleware, async (req, res) => {
  const m = getMerchant(req.params.mid);
  if (!m) return res.status(404).json({ error: 'Merchant not found' });
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
router.post('/:mid/send', authMiddleware, (req, res) => {
  const { conversationId, content } = req.body;
  if (!conversationId || !content) return res.status(400).json({ error: 'conversationId and content required' });
  res.json(wsManager.send(req.params.mid, conversationId, content));
});

// POST send image message
router.post('/:mid/send-image', authMiddleware, (req, res) => {
  const { conversationId, imageUrl, imageThumbUrl } = req.body;
  if (!conversationId || !imageUrl) return res.status(400).json({ error: 'conversationId and imageUrl required' });
  res.json(wsManager.sendImage(req.params.mid, conversationId, imageUrl, imageThumbUrl));
});

// GET status
router.get('/:mid/status/:cid', authMiddleware, (req, res) => {
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
  try {
    const r = await mexcGet('/api/v3/fiat/downloadFile', { fileId: req.params.fileId }, m.apiKey, m.apiSecret);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

const axios = require('axios');
const crypto = require('crypto');
const { bingxGet, bingxPost, P } = require('./bingxApi');
const { getDetail } = require('./bingxOrders');

/**
 * BingX order chat — REST only (BingX has no WebSocket for P2P IM).
 *
 *   history : GET  im/group/msgList  (newest first; we flip to oldest first)
 *   text    : POST im/sendMsg type=1
 *   image   : GET file/uploadUrl → HTTP PUT to the pre-signed URL (with the
 *             headers BingX hands back) → POST im/sendMsg type=2 with the
 *             file info as a JSON string
 *
 * Output shapes mirror what the MEXC chat routes already return, so
 * OrderDetailModal needs no BingX branch to render a conversation.
 *
 * "Self" is decided by uid: our uid comes from the order detail (sellerInfo
 * when we sell, buyerInfo when we buy) and is cached per merchant.
 */

const selfUidByMerchant = new Map(); // merchantId -> uid string
const uploads = new Map();            // fileId -> { fileUrl, uploadFile, at }
const UPLOAD_TTL_MS = 60 * 60 * 1000;

function okData(res) {
  if (!res || res.code !== 0) { const e = new Error(`BingX ${res?.code ?? '?'}: ${res?.msg || 'unknown error'}`); e.bingx = res; throw e; }
  return res.data;
}

async function selfUid(m, orderNo) {
  const hit = selfUidByMerchant.get(m.id);
  if (hit) return hit;
  const d = await getDetail(m, orderNo, true);
  const uid = d._self?.memberId || null;
  if (uid) selfUidByMerchant.set(m.id, uid);
  return uid;
}

function describePaymentObj(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const parts = [];
  if (obj.name) parts.push(obj.name);
  const fields = Array.isArray(obj.fields) ? obj.fields : [];
  fields.forEach(f => { if (f && f.value !== undefined && f.value !== '') parts.push(`${f.name}: ${f.value}`); });
  return parts.length ? parts.join(' · ') : JSON.stringify(obj);
}

function normalizeMessage(msg, me) {
  const type = Number(msg.type);
  const base = {
    id: msg.msgId,
    self: me !== null && me !== undefined && String(msg.sender) === String(me),
    createTime: Number(msg.sendTime) || null,
    fromNickName: '',
    raw: msg,
  };
  if (type === 2) return { ...base, type: 2, content: '', imageUrl: msg.content, imageThumbUrl: msg.content };
  if (type === 3) return { ...base, type: 4, content: '', fileUrl: msg.content };   // video → download link
  if (type === 100) return { ...base, type: 1, content: `[Info pembayaran] ${describePaymentObj(msg.contentObj) || msg.content || ''}` };
  return { ...base, type: 1, content: String(msg.content ?? '') };
}

/** Oldest → newest, MEXC-style message objects. */
async function history(m, orderNo, count = 50) {
  const [res, me] = await Promise.all([
    bingxGet(P.IM_LIST, { orderNo: String(orderNo), count: Math.min(100, Math.max(1, Number(count) || 50)) }, m.apiKey, m.apiSecret),
    selfUid(m, orderNo).catch(() => null),
  ]);
  const d = okData(res);
  const list = Array.isArray(d?.result) ? d.result : (Array.isArray(d) ? d : []);
  return list.map(x => normalizeMessage(x, me)).sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
}

async function sendText(m, orderNo, content) {
  const res = await bingxPost(P.IM_SEND, { orderNo: String(orderNo), type: 1, content: String(content) }, m.apiKey, m.apiSecret, { priority: true });
  return res.code === 0 ? { success: true } : { success: false, error: `BingX ${res.code}: ${res.msg || 'gagal kirim'}` };
}

/**
 * Upload for chat images. Returns { code, data: { fileId, fileUrl } } — the
 * same contract as MEXC's upload+download pair, so the modal's existing
 * "upload → wait for URL → send image" flow works unchanged.
 */
async function upload(m, buffer, originalname, mimetype) {
  const ext = (originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const pre = okData(await bingxGet(P.FILE_UPLOAD_URL, { bizType: 2, fileSuffix: ext }, m.apiKey, m.apiSecret, { priority: true }));
  const uploadUrl = pre.uploadUrl;
  if (!uploadUrl) throw new Error('BingX tidak memberi uploadUrl');
  const headers = { ...(pre.headers || {}) };
  if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = mimetype || 'application/octet-stream';
  headers['Content-Length'] = buffer.length;

  const put = await axios.put(uploadUrl, buffer, { headers, timeout: 30000, maxBodyLength: Infinity, validateStatus: () => true, transformResponse: [x => x] });
  if (put.status < 200 || put.status >= 300) throw new Error(`Upload ke penyimpanan BingX gagal (HTTP ${put.status}): ${String(put.data || '').slice(0, 200)}`);

  // The pre-signed PUT carries an OSS callback; the storage answers with
  // BingX's callback reply, which (per the PDF's sequence diagram) is the
  // file info sendMsg needs. If it isn't JSON we rebuild what we can.
  let info = null;
  try { const j = JSON.parse(put.data); info = j?.data?.fileInfo || j?.data || j?.fileInfo || j; } catch { info = null; }
  const u = new URL(uploadUrl);
  const cleanUrl = `${u.origin}${u.pathname}`;
  const segs = u.pathname.split('/').filter(Boolean);
  const etag = String(put.headers?.etag || '').replace(/"/g, '');
  const uploadFile = {
    url: info?.url || u.origin,
    uploadPath: info?.uploadPath || segs.slice(0, -1).join('/'),
    bucketName: info?.bucketName || '',
    fileName: info?.fileName || segs[segs.length - 1] || '',
    entityTag: info?.entityTag || etag,
    md5: info?.md5 || crypto.createHash('md5').update(buffer).digest('base64'),
  };
  // sendMsg's UploadFileDto has exactly these six fields (PDF §3.14); fileId is
  // deliberately NOT included so an unexpected key can't get the message rejected.
  const fileUrl = info?.fileUrl || cleanUrl;
  const fileId = 'bx_' + crypto.randomBytes(6).toString('hex');
  uploads.set(fileId, { fileUrl, uploadFile, at: Date.now(), calledBackJson: !!info });
  for (const [k, v] of uploads) if (Date.now() - v.at > UPLOAD_TTL_MS) uploads.delete(k);
  return { code: 0, data: { fileId, fileUrl, uploadFile, calledBackJson: !!info } };
}

function download(fileId) {
  const u = uploads.get(fileId);
  return u ? { code: 0, data: { fileUrl: u.fileUrl } } : { code: -1, msg: 'fileId tidak dikenal (kedaluwarsa?)' };
}

async function sendImage(m, orderNo, imageUrl) {
  const entry = [...uploads.values()].find(v => v.fileUrl === imageUrl);
  if (!entry) return { success: false, error: 'Info file upload tidak ditemukan — upload ulang gambarnya' };
  const res = await bingxPost(P.IM_SEND, {
    orderNo: String(orderNo), type: 2, content: imageUrl, uploadFile: JSON.stringify(entry.uploadFile),
  }, m.apiKey, m.apiSecret, { priority: true });
  return res.code === 0 ? { success: true } : { success: false, error: `BingX ${res.code}: ${res.msg || 'gagal kirim gambar'}` };
}

module.exports = { history, sendText, upload, download, sendImage, normalizeMessage };

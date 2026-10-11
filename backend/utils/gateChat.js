const crypto = require('crypto');
const { gatePost, okData, P } = require('./gateApi');
const { accountInfo, idNum, getDetail } = require('./gateOrders');

/**
 * Gate.io order chat — REST only (no WebSocket for P2P IM in APIv4).
 *
 *   history : POST chat/get_chats_list { txid }        (then we sort oldest→newest)
 *   text    : POST chat/send_chat_message { txid, type: 0, message }
 *   image   : POST chat/upload_chat_file { image_content_type, base64_img }
 *             → file_key, then send_chat_message { type: 1, message: file_key }
 *
 * Output shapes mirror what the MEXC chat routes return, so OrderDetailModal
 * needs no Gate branch to render a conversation. The order id IS the room.
 *
 * Who sent a message: Gate's message rows carry `username` and (sometimes)
 * `uid`. The reference's examples literally use "Self" / "Other" / "System";
 * a live account may send real usernames instead, so "ours" is decided by
 * either marker — the literal "Self", or a username equal to the merchant's
 * own user_name (get_user_info, cached) — and "theirs" by "Other", the
 * counterpart's nickname (order detail), or a uid equal to the
 * counterpart's its_uid. Everything else falls back to "theirs", which is
 * the safe side for the auto-reply double-send check (it only ever skips a
 * send when it sees OUR text).
 */

const selfNameByMerchant = new Map(); // merchantId -> { at, name }
const cpByOrder = new Map();           // `${mid}:${txid}` -> { at, nick, uid }
const uploads = new Map();             // fileId -> { fileKey, at }
const UPLOAD_TTL_MS = 60 * 60 * 1000;

async function selfName(m) {
  const hit = selfNameByMerchant.get(m.id);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.name;
  try {
    const info = await accountInfo(m, false);
    const name = info.user_name || null;
    selfNameByMerchant.set(m.id, { at: Date.now(), name });
    return name;
  } catch { return hit ? hit.name : null; }
}
async function counterpart(m, txid) {
  const k = `${m.id}:${txid}`;
  const hit = cpByOrder.get(k);
  if (hit && Date.now() - hit.at < 30 * 60000) return hit;
  try {
    const d = await getDetail(m, txid, false);
    const v = { at: Date.now(), nick: d.userInfo?.nickName || '', uid: d.userInfo?.memberId || '' };
    cpByOrder.set(k, v);
    if (cpByOrder.size > 500) cpByOrder.delete(cpByOrder.keys().next().value);
    return v;
  } catch { return hit || { nick: '', uid: '' }; }
}

function describePayment(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const parts = [obj.pay_name || obj.pay_type, obj.account, obj.real_name, obj.account_des, obj.memo].filter(Boolean);
  if (Number(obj.is_delete) === 1) parts.push('(sudah dihapus)');
  return parts.join(' · ');
}

const STATUS_TEXT = {
  OPEN: 'Order dibuat — menunggu pembayaran buyer', PAID: 'Buyer menandai sudah bayar', LOCKED: 'Order dikunci (banding / tinjauan)',
  ACCEPT: 'Order selesai — koin dilepas', BCLOSED: 'Banding diputus: order diselesaikan', CANCEL: 'Order dibatalkan',
  BECANCEL: 'Order dibatalkan', SCANCEL: 'Order dibatalkan', SCLOSED: 'Banding diputus: order dibatalkan', TEMP: 'Order sementara',
};

function normalizeMessage(msg, ctx, i) {
  const user = String(msg.username ?? '');
  const uid = String(msg.uid ?? '');
  const isSystem = Number(msg.type) === 2 || uid === 'System' || user === 'System';
  const self = !isSystem && (user === 'Self' || (!!ctx.me && user === ctx.me));
  const createTime = msg.timest ? (Number(msg.timest) > 1e12 ? Number(msg.timest) : Number(msg.timest) * 1000) : null;
  const base = {
    id: `${createTime || 0}:${i}`,
    self,
    createTime,
    fromNickName: self ? '' : (user === 'Other' ? (ctx.nick || '') : user),
    raw: msg,
  };
  const mt = Number(msg.msg_type);
  if (isSystem) return { ...base, type: 1, system: true, content: String(msg.msg ?? '') };
  if (mt === 5) {
    const o = msg.msg_obj || {};
    const st = String(o.status || '').toUpperCase();
    const extra = [o.reason_memo, o.reason_id ? `alasan #${o.reason_id}` : null].filter(Boolean).join(' — ');
    return { ...base, type: 1, system: true, content: `${o.text || STATUS_TEXT[st] || st || 'Status order berubah'}${extra ? ` (${extra})` : ''}`, status: st };
  }
  if (mt === 4) return { ...base, type: 1, content: `[Info pembayaran] ${describePayment(msg.msg_obj) || msg.msg || ''}` };
  if (mt === 1 || Number(msg.type) === 1 || msg.pic) {
    const url = msg.pic || msg.msg || '';
    if (String(msg.file_type || '').toLowerCase() === 'video') return { ...base, type: 4, content: '', fileUrl: url };
    return { ...base, type: 2, content: '', imageUrl: url, imageThumbUrl: url };
  }
  const out = { ...base, type: 1, content: String(msg.msg ?? '') };
  if (Number(msg.risk_type) === 1 && msg.toast_msg) out.warning = String(msg.toast_msg);
  return out;
}

/** Oldest → newest, MEXC-style message objects (last `count`). */
async function history(m, txid, count = 50) {
  const [res, me, cp] = await Promise.all([
    gatePost(P.CHAT_LIST, { txid: idNum(txid) }, m.apiKey, m.apiSecret),
    selfName(m).catch(() => null),
    counterpart(m, txid),
  ]);
  const d = okData(res);
  const list = Array.isArray(d?.messages) ? d.messages : [];
  const ctx = { me, nick: cp.nick, uid: cp.uid };
  const msgs = list.map((x, i) => normalizeMessage(x, ctx, i)).sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
  const n = Math.min(200, Math.max(1, Number(count) || 50));
  return msgs.length > n ? msgs.slice(msgs.length - n) : msgs;
}

async function sendText(m, txid, content) {
  const text = String(content ?? '');
  if (!text.trim()) return { success: false, error: 'Pesan kosong' };
  if (text.length > 500) return { success: false, error: 'Gate membatasi 500 karakter per pesan' };
  const res = await gatePost(P.CHAT_SEND, { txid: idNum(txid), type: 0, message: text }, m.apiKey, m.apiSecret, { priority: true });
  if (res.code !== 0) return { success: false, error: `Gate ${res.code}: ${res.message || 'gagal kirim'}` };
  // Risk control hit: Gate answers code 0 but flags the text. The message
  // is treated as sent (it may be delivered with a warning on Gate's side).
  if (Number(res.data?.risk_type) === 1) return { success: true, warning: res.data?.toast_msg || 'Gate menandai pesan ini sebagai berisiko (risk control).' };
  return { success: true };
}

const MIME_OK = new Set(['image/jpeg', 'image/jpg', 'image/png', 'video/mp4']);
/**
 * Upload for chat files. Returns { code, data: { fileId, fileUrl } } — the
 * same contract as MEXC's upload+download pair. `fileUrl` is the Gate
 * file_key; the message is sent by key, so no public URL is needed.
 */
async function upload(m, buffer, originalname, mimetype) {
  let mime = String(mimetype || '').toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!MIME_OK.has(mime)) throw new Error('Gate hanya menerima JPEG, PNG, atau MP4 untuk chat');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('File melebihi 20 MB (batas Gate)');
  const res = await gatePost(P.CHAT_UPLOAD, { image_content_type: mime, base64_img: buffer.toString('base64') }, m.apiKey, m.apiSecret, { priority: true });
  const fileKey = okData(res)?.file_key;
  if (!fileKey) throw new Error('Gate tidak mengembalikan file_key');
  const fileId = 'gt_' + crypto.randomBytes(6).toString('hex');
  uploads.set(fileId, { fileKey, at: Date.now() });
  for (const [k, v] of uploads) if (Date.now() - v.at > UPLOAD_TTL_MS) uploads.delete(k);
  return { code: 0, data: { fileId, fileUrl: fileKey } };
}

function download(fileId) {
  const u = uploads.get(fileId);
  return u ? { code: 0, data: { fileUrl: u.fileKey } } : { code: -1, msg: 'fileId tidak dikenal (kedaluwarsa?)' };
}

async function sendImage(m, txid, fileKey) {
  const key = String(fileKey || '');
  if (!key) return { success: false, error: 'file_key kosong — upload ulang gambarnya' };
  const res = await gatePost(P.CHAT_SEND, { txid: idNum(txid), type: 1, message: key }, m.apiKey, m.apiSecret, { priority: true });
  return res.code === 0 ? { success: true } : { success: false, error: `Gate ${res.code}: ${res.message || 'gagal kirim gambar'}` };
}

module.exports = { history, sendText, upload, download, sendImage, normalizeMessage, selfName };

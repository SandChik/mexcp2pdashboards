const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
let webpush = null;
try { webpush = require('web-push'); } catch { /* dependency missing → web push disabled, Telegram still works */ }

/**
 * Notifier — delivers order events to the operator's devices.
 *
 * Two channels, both fed by orderWatcher.js:
 *   Web Push  — browser push via a service worker. Needs HTTPS on the
 *               dashboard URL; VAPID keys are generated once and kept OUTSIDE
 *               the repo (~/.mexc-dashboard/vapid.json, like the API-key
 *               encryption key), subscriptions in backend/data/.
 *   Telegram  — bot sendMessage. No HTTPS, no install, works everywhere.
 *
 * Settings (which events, Telegram token/chat) live in
 * backend/data/notify-settings.json.
 */

const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_PATH = path.join(DATA_DIR, 'notify-settings.json');
const SUBS_PATH = path.join(DATA_DIR, 'push-subscriptions.json');
const KEY_DIR = path.join(os.homedir(), '.mexc-dashboard');
const VAPID_PATH = path.join(KEY_DIR, 'vapid.json');

const EVENT_DEFS = {
  newOrder:  { label: 'Order baru',                 default: true },
  paid:      { label: 'Buyer sudah bayar (siap release)', default: true },
  message:   { label: 'Pesan chat masuk',           default: true },
  cancelled: { label: 'Order dibatalkan / timeout', default: true },
  appeal:    { label: 'Banding / status tak dikenal', default: true },
  done:      { label: 'Order selesai',              default: false },
};
const DEFAULT_SETTINGS = {
  events: Object.fromEntries(Object.entries(EVENT_DEFS).map(([k, v]) => [k, v.default])),
  telegram: { enabled: false, botToken: '', chatId: '' },
  quietHours: null, // reserved
};

function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJson(p, v) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); } catch (e) { console.error('[notify] write failed', p, e.message); } }

function getSettings() {
  const s = readJson(SETTINGS_PATH, {});
  return { ...DEFAULT_SETTINGS, ...s, events: { ...DEFAULT_SETTINGS.events, ...(s.events || {}) }, telegram: { ...DEFAULT_SETTINGS.telegram, ...(s.telegram || {}) } };
}
function saveSettings(patch) {
  const cur = getSettings();
  const next = { ...cur, ...patch, events: { ...cur.events, ...(patch.events || {}) }, telegram: { ...cur.telegram, ...(patch.telegram || {}) } };
  writeJson(SETTINGS_PATH, next);
  return next;
}
/** Settings safe to hand to the browser: the bot token is masked. */
function publicSettings() {
  const s = getSettings();
  const t = s.telegram.botToken || '';
  return { ...s, telegram: { ...s.telegram, botToken: t ? `${t.slice(0, 6)}…${t.slice(-4)}` : '', botTokenSet: !!t } };
}

// ── VAPID ───────────────────────────────────────────────────────────
function vapid() {
  if (!webpush) return null;
  let k = readJson(VAPID_PATH, null);
  if (!k || !k.publicKey || !k.privateKey) {
    k = webpush.generateVAPIDKeys();
    try { fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(VAPID_PATH, JSON.stringify(k), { mode: 0o600 }); }
    catch (e) { console.error('[notify] cannot persist VAPID keys:', e.message); }
  }
  webpush.setVapidDetails('mailto:ops@sandchik.local', k.publicKey, k.privateKey);
  return k;
}

// ── Subscriptions ───────────────────────────────────────────────────
function listSubs() { return readJson(SUBS_PATH, []); }
function addSub(sub, meta = {}) {
  const subs = listSubs().filter(s => s.endpoint !== sub.endpoint);
  const rec = { id: crypto.createHash('sha1').update(sub.endpoint).digest('hex').slice(0, 12), endpoint: sub.endpoint, keys: sub.keys, ua: meta.ua || '', label: meta.label || '', createdAt: Date.now(), lastOkAt: null, fails: 0 };
  subs.push(rec); writeJson(SUBS_PATH, subs); return rec;
}
function removeSub(endpointOrId) {
  const subs = listSubs();
  const next = subs.filter(s => s.endpoint !== endpointOrId && s.id !== endpointOrId);
  writeJson(SUBS_PATH, next);
  return subs.length - next.length;
}

// ── Delivery ────────────────────────────────────────────────────────
const log = []; // last 50 deliveries, for the settings screen
function remember(entry) { log.unshift({ at: Date.now(), ...entry }); if (log.length > 50) log.pop(); }

async function pushAll(payload) {
  if (!webpush) return { sent: 0, failed: 0, skipped: 'web-push tidak terpasang' };
  const k = vapid(); if (!k) return { sent: 0, failed: 0 };
  const subs = listSubs();
  let sent = 0, failed = 0; const body = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 600, urgency: 'high' });
      s.lastOkAt = Date.now(); s.fails = 0; sent++;
    } catch (e) {
      failed++;
      const code = e.statusCode || 0;
      if (code === 404 || code === 410) { removeSub(s.endpoint); continue; } // gone: browser unsubscribed
      s.fails = (s.fails || 0) + 1; s.lastError = `${code} ${e.body || e.message}`.slice(0, 160);
    }
  }
  writeJson(SUBS_PATH, listSubs().map(x => subs.find(s => s.endpoint === x.endpoint) || x));
  return { sent, failed };
}

async function telegramSend(text, { botToken, chatId } = {}) {
  const s = getSettings().telegram;
  const token = botToken || s.botToken, chat = chatId || s.chatId;
  if (!token || !chat) return { ok: false, error: 'token/chat id belum diisi' };
  try {
    const r = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 10000 });
    return r.data?.ok ? { ok: true } : { ok: false, error: JSON.stringify(r.data).slice(0, 160) };
  } catch (e) {
    return { ok: false, error: e.response?.data?.description || e.message };
  }
}
/** Find the chat id of whoever last messaged the bot (getUpdates). */
async function telegramDetectChat(botToken) {
  const token = botToken || getSettings().telegram.botToken;
  if (!token) return { ok: false, error: 'token kosong' };
  try {
    const r = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, { timeout: 10000 });
    const ups = Array.isArray(r.data?.result) ? r.data.result : [];
    const last = [...ups].reverse().map(u => u.message || u.channel_post || u.my_chat_member?.chat && { chat: u.my_chat_member.chat }).find(Boolean);
    if (!last) return { ok: false, error: 'Belum ada pesan ke bot. Buka bot di Telegram, tekan Start / kirim "halo", lalu coba lagi.' };
    const c = last.chat || {};
    return { ok: true, chatId: String(c.id), title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '' };
  } catch (e) {
    return { ok: false, error: e.response?.data?.description || e.message };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtIdr = (n) => { const v = Math.round(parseFloat(n) || 0); return v.toLocaleString('id-ID'); };

/** Build the human text for an event. `o` is a house-shaped order. */
function compose(ev) {
  const { type, merchant, o } = ev;
  const plat = (merchant.platform || 'mexc').toUpperCase();
  const who = o.userInfo?.realName || o.userInfo?.nickName || '—';
  const money = `${fmtIdr(o.amount)} ${o.fiatUnit || ''} · ${parseFloat(o.tradableQuantity || 0).toFixed(2)} USDT`;
  const side = o.side === 'BUY' ? 'BELI' : 'JUAL';
  const heads = {
    newOrder:  ['🆕 Order baru', `${side} · ${money}`],
    paid:      ['💸 Buyer sudah bayar — siap release', money],
    message:   ['💬 Pesan chat masuk', `${o.unreadCount || 1} pesan belum dibaca`],
    cancelled: ['❌ Order dibatalkan', money],
    appeal:    ['⚠️ Banding / status tak dikenal', `${money}${o._bingx?.orderStatus !== undefined ? ` · status BingX ${o._bingx.orderStatus}` : ''}`],
    done:      ['✅ Order selesai', money],
  };
  const [title, line] = heads[type] || [type, ''];
  const url = ev.url || '/queue';
  return {
    title: `${title} · ${merchant.name}`,
    body: `${who}\n${line}`,
    tag: `${merchant.id}:${o.advOrderNo}:${type}`,
    url,
    telegram: `<b>${esc(title)}</b> · ${esc(merchant.name)} <i>(${plat})</i>\n${esc(who)}\n${esc(line)}\n#${esc(String(o.advOrderNo).slice(-8))}`,
  };
}

async function dispatch(ev) {
  const settings = getSettings();
  if (settings.events[ev.type] === false) return { skipped: 'event off' };
  const msg = compose(ev);
  const [push, tg] = await Promise.all([
    pushAll({ title: msg.title, body: msg.body, tag: msg.tag, url: msg.url, type: ev.type }),
    settings.telegram.enabled ? telegramSend(msg.telegram) : Promise.resolve({ ok: null }),
  ]);
  remember({ type: ev.type, merchant: ev.merchant.name, order: String(ev.o.advOrderNo).slice(-8), push, telegram: tg });
  return { push, telegram: tg };
}

async function testAll() {
  const fake = { type: 'newOrder', merchant: { id: 'test', name: 'Tes', platform: 'mexc' }, o: { advOrderNo: '000000TEST', side: 'SELL', amount: '1500000', fiatUnit: 'IDR', tradableQuantity: '92.5', userInfo: { nickName: 'tes@notifikasi' } } };
  const settings = getSettings();
  const msg = compose(fake);
  const push = await pushAll({ title: '🔔 Tes notifikasi · SandChik P2P', body: 'Kalau ini muncul, Web Push jalan di perangkat ini.', tag: 'test', url: '/queue', type: 'test' });
  const tg = settings.telegram.enabled ? await telegramSend('🔔 <b>Tes notifikasi</b> — Telegram terhubung ke SandChik P2P.\n\nContoh format:\n' + msg.telegram) : { ok: null };
  remember({ type: 'test', merchant: '—', order: '—', push, telegram: tg });
  return { push, telegram: tg };
}

function status() {
  return {
    webPush: !!webpush,
    publicKey: webpush ? vapid()?.publicKey : null,
    subscriptions: listSubs().map(s => ({ id: s.id, ua: s.ua, label: s.label, createdAt: s.createdAt, lastOkAt: s.lastOkAt, fails: s.fails || 0, lastError: s.lastError || null })),
    events: EVENT_DEFS,
    settings: publicSettings(),
    recent: log.slice(0, 20),
  };
}

module.exports = { EVENT_DEFS, getSettings, saveSettings, publicSettings, vapid, listSubs, addSub, removeSub, dispatch, testAll, telegramSend, telegramDetectChat, status };

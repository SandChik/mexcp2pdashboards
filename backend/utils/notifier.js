const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const { bankName } = require('./bankMap');
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
  verify:    { label: 'Buyer menunggu verifikasi (setujui di app MEXC)', default: true },
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
// Apple's push service validates the VAPID `sub` claim strictly and answers
// 403 {"reason":"BadJwtToken"} when it dislikes it (seen with a mailto: on a
// made-up .local domain). Chrome/FCM never cared. So the subject sent to each
// device is the HTTPS origin the device subscribed FROM — always a real,
// valid URL — with an env override for anyone who wants a contact address.
const DEFAULT_SUBJECT = process.env.NOTIFY_VAPID_SUBJECT || 'https://sandchik-p2p.invalid';
function subjectFor(sub) {
  if (process.env.NOTIFY_VAPID_SUBJECT) return process.env.NOTIFY_VAPID_SUBJECT;
  if (sub && /^https:\/\//.test(sub.origin || '')) return sub.origin;
  // Devices subscribed before origins were recorded: borrow the origin any
  // other device used — it is the same dashboard.
  const known = listSubs().map(x => x.origin).find(o => /^https:\/\//.test(o || ''));
  return known || DEFAULT_SUBJECT;
}
function vapid() {
  if (!webpush) return null;
  let k = readJson(VAPID_PATH, null);
  if (!k || !k.publicKey || !k.privateKey) {
    k = webpush.generateVAPIDKeys();
    try { fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(VAPID_PATH, JSON.stringify(k), { mode: 0o600 }); }
    catch (e) { console.error('[notify] cannot persist VAPID keys:', e.message); }
  }
  webpush.setVapidDetails(DEFAULT_SUBJECT, k.publicKey, k.privateKey);
  return k;
}

// ── Subscriptions ───────────────────────────────────────────────────
function listSubs() { return readJson(SUBS_PATH, []); }
function addSub(sub, meta = {}) {
  const subs = listSubs().filter(s => s.endpoint !== sub.endpoint);
  const rec = { id: crypto.createHash('sha1').update(sub.endpoint).digest('hex').slice(0, 12), endpoint: sub.endpoint, keys: sub.keys, ua: meta.ua || '', label: meta.label || '', origin: meta.origin || '', createdAt: Date.now(), lastOkAt: null, fails: 0 };
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
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
        TTL: 600, urgency: 'high',
        vapidDetails: { subject: subjectFor(s), publicKey: k.publicKey, privateKey: k.privateKey },
      });
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

const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtFiat = (n, unit) => {
  const v = Math.round(parseFloat(n) || 0).toLocaleString('id-ID');
  return (unit || 'IDR') === 'IDR' ? `Rp ${v}` : `${v} ${unit}`;
};
const fmtUsdt = (n) => `${(parseFloat(n) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

// ── Detail enrichment ───────────────────────────────────────────────
// The list row has nickname + amounts; the KYC name and the receiving account
// only live in the order detail. One fetch per order, cached 15 minutes, so
// "new → paid → done" costs one detail call, not three.
const detailCache = new Map(); // `${mid}:${orderNo}` -> { at, info }
async function enrich(merchant, o) {
  const key = `${merchant.id}:${o.advOrderNo}`;
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60000) return hit.info;
  let info = { realName: null, pay: null };
  try {
    let d;
    if (merchant.platform === 'bingx') {
      d = await require('./bingxOrders').getDetail(merchant, o.advOrderNo, true);
    } else {
      const { mexcGet } = require('./mexcApi');
      const r = await mexcGet('/api/v3/fiat/order/detail', { advOrderNo: o.advOrderNo }, merchant.apiKey, merchant.apiSecret, { priority: true });
      d = r?.data || null;
    }
    if (d) {
      const p = d.confirmPaymentInfo || (Array.isArray(d.paymentInfo) ? d.paymentInfo[0] : null);
      info = {
        realName: d.userInfo?.realName || null,
        pay: p ? { bank: bankName(p.payMethod, p.bankName), account: p.account || '', payee: p.payee || '' } : null,
      };
    }
  } catch { /* fall back to list fields */ }
  detailCache.set(key, { at: Date.now(), info });
  for (const [k, v] of detailCache) if (Date.now() - v.at > 30 * 60000) detailCache.delete(k);
  return info;
}

/** Build title/body/HTML for an event. `o` is a house-shaped list row. */
function compose(ev, info = {}) {
  const { type, merchant, o } = ev;
  const plat = (merchant.platform || 'mexc') === 'bingx' ? 'BingX' : 'MEXC';
  const name = info.realName || null;
  const nick = o.userInfo?.nickName || '';
  const side = o.side === 'BUY' ? 'BELI' : 'JUAL';
  const fiat = fmtFiat(o.amount, o.fiatUnit);
  const usdt = fmtUsdt(o.tradableQuantity);
  const heads = {
    newOrder:  ['🆕', 'Order baru'],
    paid:      ['💸', 'Buyer sudah bayar — siap release'],
    message:   ['💬', `Pesan chat masuk (${o.unreadCount || 1} belum dibaca)`],
    cancelled: ['❌', 'Order dibatalkan'],
    appeal:    ['⚠️', o._bingx?.orderStatus !== undefined && o.state === 10 ? `Status BingX tak dikenal (${o._bingx.orderStatus})` : 'Banding'],
    verify:    ['🪪', 'Buyer menunggu verifikasi — setujui/tolak di app MEXC'],
    done:      ['✅', 'Order selesai'],
  };
  const [icon, head] = heads[type] || ['🔔', type];
  const pay = info.pay;
  const bankLine = pay ? `${pay.bank || '—'}${pay.account ? ` · ${pay.account}` : ''}${pay.payee ? ` · a/n ${pay.payee}` : ''}` : null;
  const no = String(o.advOrderNo);

  const tgLines = [
    `${icon} <b>${esc(head)}</b>`,
    `<i>${esc(merchant.name)} · ${plat}</i>`,
    '',
    `👤 <b>${esc(name || nick || '—')}</b>${name && nick ? `\n     ${esc(nick)}` : ''}`,
    `🔁 <b>${side}</b> ${esc(usdt)}`,
    `💰 <b>${esc(fiat)}</b>`,
  ];
  if (pay) tgLines.push(`🏦 ${esc(pay.bank || '—')}${pay.account ? ` · <code>${esc(pay.account)}</code>` : ''}${pay.payee ? `\n     a/n ${esc(pay.payee)}` : ''}`);
  tgLines.push(`🧾 <code>${esc(no)}</code>`);

  const pushBody = [
    `${name || nick || '—'}`,
    `${side} ${usdt} · ${fiat}`,
    bankLine,
  ].filter(Boolean).join('\n');

  return {
    title: `${icon} ${head} · ${merchant.name}`,
    body: pushBody,
    tag: `${merchant.id}:${no}:${type}`,
    url: ev.url || '/queue',
    telegram: tgLines.join('\n'),
  };
}

async function dispatch(ev) {
  const settings = getSettings();
  if (settings.events[ev.type] === false) return { skipped: 'event off' };
  const info = ev.merchant?.id && ev.merchant.id !== 'test' ? await enrich(ev.merchant, ev.o) : {};
  const msg = compose(ev, info);
  const [push, tg] = await Promise.all([
    pushAll({ title: msg.title, body: msg.body, tag: msg.tag, url: msg.url, type: ev.type }),
    settings.telegram.enabled ? telegramSend(msg.telegram) : Promise.resolve({ ok: null }),
  ]);
  remember({ type: ev.type, merchant: ev.merchant.name, order: String(ev.o.advOrderNo).slice(-8), push, telegram: tg });
  return { push, telegram: tg };
}

async function testAll() {
  const fake = { type: 'paid', merchant: { id: 'test', name: 'Contoh Merchant', platform: 'mexc' }, o: { advOrderNo: '20260922000000TEST', side: 'SELL', amount: '1500000', fiatUnit: 'IDR', tradableQuantity: '92.5', userInfo: { nickName: 'bu***i@gmail.com' } } };
  const settings = getSettings();
  const msg = compose(fake, { realName: 'BUDI SANTOSO', pay: { bank: 'BCA', account: '1234567890', payee: 'SANDCHIK' } });
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

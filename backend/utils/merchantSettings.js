const fs = require('fs');
const path = require('path');

/**
 * Per-merchant dashboard settings — ONE definition of the defaults.
 *
 * The bug this file fixes (found in production, Sep 2026): the settings route
 * merged these defaults into what the UI shows, so a merchant that had never
 * pressed "Save rules" saw five active-looking rules and the toggle ON — while
 * the auto-reply worker read the raw file, found no entry for that merchant,
 * and ran zero rules. What the screen shows must be what the worker runs, so
 * both now go through effectiveSettings().
 */
const SETTINGS_PATH = path.join(__dirname, '../data/merchant-settings.json');

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
// buyerLogSources (v81): which buyer-log records this merchant's "nama sama"
// alert compares against — merchant ids and/or 'manual' (imports). null = never
// chosen → the merchant itself + imports (the v80 behaviour). See sourcesOf().
const DEFAULT_SETTINGS = { buyerLog: false, autoReplyEnabled: true, autoReplyRules: DEFAULT_RULES, quickReplies: DEFAULT_QUICK, buyerLogSources: null };

function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; } }
function writeSettings(o) { try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(o, null, 2)); } catch {} }
/** Settings as the UI shows them: defaults filled in for anything never saved. */
function effectiveSettings(all, merchantId) { return { ...DEFAULT_SETTINGS, ...((all || {})[merchantId] || {}) }; }

/** The buyer-log sources a merchant's duplicate alert reads (v81). */
function sourcesOf(all, merchantId) {
  const s = effectiveSettings(all, merchantId).buyerLogSources;
  return Array.isArray(s) ? s : [merchantId, 'manual'];
}
/** Keep only plausible ids (strings, deduped, capped) — the list comes from the browser. */
function cleanSources(v) {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, 32);
}

module.exports = { SETTINGS_PATH, DEFAULT_QUICK, DEFAULT_RULES, DEFAULT_SETTINGS, readSettings, writeSettings, effectiveSettings, sourcesOf, cleanSources };

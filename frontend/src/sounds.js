/**
 * Sound engine — ONE audio file for every event.
 *
 * Previously each event had its own synthesised motif, so you could tell what
 * happened by ear. That is gone by request: every event now plays the same
 * clip. The trade-off is real and worth knowing — a sound no longer tells you
 * WHICH event fired, only THAT something fired, so you have to look at the
 * screen. The per-event toggles below are what keeps that manageable: switch
 * off the noisy events and the ones left are the ones worth looking up for.
 *
 * The file lives in public/ (served at /notif.mp3) rather than being inlined,
 * so the browser caches it once instead of carrying it in every JS bundle.
 */

const KEY = 'mexc_sound_prefs';
const SRC = '/notif.mp3';
const POOL = 4;        // overlapping plays — a burst of orders shouldn't cut itself off
const MAX_MS = 2500;   // hard stop, so a mis-encoded file can never drone on

const DEFAULTS = {
  enabled: true,
  volume: 0.5,          // 0..1
  events: {             // per-event toggles
    newOrder: true,
    unpaid: true,
    paid: true,
    waiting: true,
    processing: true,
    done: true,
    cancelled: true,
    invalid: true,
    refused: true,
    timeout: true,
    message: true,
    duplicate: true,
    error: true,
  },
};

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...raw, events: { ...DEFAULTS.events, ...(raw.events || {}) } };
  } catch { return { ...DEFAULTS }; }
}
let prefs = loadPrefs();

export function getSoundPrefs() { return prefs; }
export function setSoundPrefs(patch) {
  prefs = { ...prefs, ...patch, events: { ...prefs.events, ...(patch.events || {}) } };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  return prefs;
}

// -- Audio elements ---------------------------------------------------------
// A small ring of preloaded elements. Creating a fresh Audio() per play leaks
// elements over a long trading session; reusing four covers any realistic burst.
let pool = null, cursor = 0, fileBroken = false;

function ensurePool() {
  if (pool || typeof Audio === 'undefined') return pool;
  pool = [];
  for (let i = 0; i < POOL; i++) {
    const a = new Audio(SRC);
    a.preload = 'auto';
    // A missing/unservable file must not fail silently — without this the app
    // would just go quiet after a deploy that forgot to copy public/.
    a.addEventListener('error', () => { fileBroken = true; }, { once: true });
    pool.push(a);
  }
  return pool;
}

// Browsers block audio until the page has been interacted with. Touch the
// elements on the first gesture so the first real notification isn't the one
// that gets swallowed.
if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
  const unlock = () => {
    const p = ensurePool();
    if (p && p[0]) p[0].load();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

// -- Fallback ---------------------------------------------------------------
// Only used when the mp3 itself cannot be loaded. Two plain tones — ugly on
// purpose, so "the sound file is missing" is audible rather than invisible.
let ctx = null;
function fallbackBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    [660, 880].forEach((f, i) => {
      const t0 = ctx.currentTime + i * 0.12;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.15 * prefs.volume), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + 0.2);
    });
  } catch { /* audio unavailable */ }
}

function playClip() {
  if (fileBroken) { fallbackBeep(); return; }
  const p = ensurePool();
  if (!p) return;
  const a = p[cursor];
  cursor = (cursor + 1) % p.length;
  try {
    a.pause();
    a.currentTime = 0;
    a.volume = Math.min(1, Math.max(0, prefs.volume));
    const done = a.play();
    if (done && done.catch) done.catch(() => { /* blocked until first gesture */ });
    setTimeout(() => { try { if (!a.paused) { a.pause(); a.currentTime = 0; } } catch { /* */ } }, MAX_MS);
  } catch { fallbackBeep(); }
}

/** Play the notification sound, respecting mute + per-event toggles. */
export function playSound(event) {
  if (!prefs.enabled) return;
  if (prefs.events[event] === false) return;
  playClip();
}

/** Preview from the settings UI — ignores the per-event toggle, honours volume. */
export function previewSound() { playClip(); }

export const SOUND_EVENTS = [
  { key: 'newOrder',   label: 'Order baru masuk',   hint: 'Order baru muncul di salah satu merchant' },
  { key: 'unpaid',     label: 'Belum bayar',        hint: 'Pembeli belum transfer' },
  { key: 'paid',       label: 'Sudah bayar',        hint: 'Giliran Anda release' },
  { key: 'waiting',    label: 'Menunggu diproses',  hint: 'Order masuk antrean merchant' },
  { key: 'processing', label: 'Sedang diproses',    hint: 'Order sedang berjalan' },
  { key: 'done',       label: 'Selesai',            hint: 'Order tuntas' },
  { key: 'cancelled',  label: 'Dibatalkan',         hint: 'Order dibatalkan' },
  { key: 'invalid',    label: 'Invalid',            hint: 'Order dianggap tidak sah' },
  { key: 'refused',    label: 'Ditolak',            hint: 'Order ditolak' },
  { key: 'timeout',    label: 'Timeout',            hint: 'Lewat batas waktu bayar' },
  { key: 'message',    label: 'Pesan chat baru',    hint: 'Pembeli mengirim pesan' },
  { key: 'duplicate',  label: 'Nama KYC duplikat',  hint: 'Nama ini sudah pernah order' },
  { key: 'error',      label: 'Gagal sync ke MEXC', hint: 'Koneksi atau API key bermasalah' },
];

/** Map an order state to its event key. */
const STATE_SOUND = {
  0: 'unpaid', 1: 'paid', 2: 'waiting', 3: 'processing',
  4: 'done', 5: 'cancelled', 6: 'invalid', 7: 'refused', 8: 'timeout',
};
export function soundForState(state) {
  return STATE_SOUND[state] || null;
}

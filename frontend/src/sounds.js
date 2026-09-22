/**
 * Sound engine — one file per event, in public/sounds/<event>.mp3.
 *
 * Five source clips cover thirteen events, grouped by what you'd actually DO
 * about them rather than by state name:
 *
 *   paid                              money is waiting on you — release it
 *   newOrder                          an order arrived
 *   message                           the buyer said something
 *   done                              closed well
 *   cancelled/invalid/refused/timeout  closed badly — all share one sound
 *   duplicate/error                   something needs checking
 *   unpaid/waiting/processing         intermediate steps; noisy, ship muted
 *
 * All clips are trimmed and levelled to the same loudness, so no single event
 * is startlingly louder than the rest.
 *
 * TO REPLACE ANY SOUND: drop your own mp3 at public/sounds/<event>.mp3 with the
 * same filename. No code change. Anything that fails to load falls back to
 * /notif.mp3, so a missing file degrades instead of going silent.
 */

const KEY = 'mexc_sound_prefs';
const FALLBACK_SRC = '/notif.mp3';
const srcFor = (event) => `/sounds/${event}.mp3`;
const MAX_MS = 4000;   // hard stop, so a mis-encoded replacement can't drone on

const DEFAULTS = {
  enabled: true,
  volume: 0.5,          // 0..1
  events: {             // per-event toggles
    newOrder: true,
    // Off by default: these fire on almost every order and carry no decision.
    // Existing installs keep whatever is already in localStorage — switch them
    // off in Settings if the dashboard has been noisy.
    unpaid: false,
    waiting: false,
    processing: false,
    paid: true,
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
// One element per event, created on first use. Loading all thirteen up front
// would spend bandwidth on sounds a given session may never play.
const cache = new Map();
let anyBroken = false;

function elFor(event) {
  if (typeof Audio === 'undefined') return null;
  let a = cache.get(event);
  if (!a) {
    a = new Audio(srcFor(event));
    a.preload = 'auto';
    // A missing per-event file must not mean silence — fall back to the base
    // clip once, so a bad deploy is survivable rather than mute.
    a.addEventListener('error', () => {
      if (a.src.endsWith(FALLBACK_SRC)) { anyBroken = true; return; }
      a.src = FALLBACK_SRC;
      a.load();
    });
    cache.set(event, a);
  }
  return a;
}

// Browsers block audio until the page has been interacted with. Warm the two
// most common sounds on the first gesture so the first real notification isn't
// the one that gets swallowed.
if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
  const unlock = () => {
    ['paid', 'newOrder'].forEach(e => { const a = elFor(e); if (a) a.load(); });
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

function playClip(event) {
  if (anyBroken) { fallbackBeep(); return; }
  const base = elFor(event);
  if (!base) return;
  const vol = Math.min(1, Math.max(0, prefs.volume));
  // Still playing? Use a throwaway copy so two orders landing together are both
  // heard instead of the second cutting the first off mid-word.
  const a = base.paused ? base : base.cloneNode();
  try {
    a.currentTime = 0;
    a.volume = vol;
    const done = a.play();
    if (done && done.catch) done.catch(() => { /* blocked until first gesture */ });
    setTimeout(() => { try { if (!a.paused) { a.pause(); a.currentTime = 0; } } catch { /* */ } }, MAX_MS);
  } catch { fallbackBeep(); }
}

/** Play the notification sound, respecting mute + per-event toggles. */
export function playSound(event) {
  if (!prefs.enabled) return;
  if (prefs.events[event] === false) return;
  playClip(event);
}

/** Preview from the settings UI — ignores the per-event toggle, honours volume. */
export function previewSound(event = 'newOrder') { playClip(event); }

// `hint` describes what the sound is like, so the preview button in Settings
// teaches the mapping instead of just making noise.
export const SOUND_EVENTS = [
  { key: 'paid',       label: 'Sudah bayar',        hint: 'Giliran Anda release — suara sukses' },
  { key: 'newOrder',   label: 'Order baru masuk',   hint: 'Suara "order masuk"' },
  { key: 'message',    label: 'Pesan chat baru',    hint: 'Suara "pesan masuk"' },
  { key: 'done',       label: 'Selesai',            hint: 'Suara achievement — order tuntas' },
  { key: 'cancelled',  label: 'Dibatalkan',         hint: 'Suara "order ditutup"' },
  { key: 'timeout',    label: 'Timeout',            hint: 'Sama dengan Dibatalkan' },
  { key: 'refused',    label: 'Ditolak',            hint: 'Sama dengan Dibatalkan' },
  { key: 'invalid',    label: 'Invalid',            hint: 'Sama dengan Dibatalkan' },
  { key: 'duplicate',  label: 'Nama KYC duplikat',  hint: 'Suara alert — perlu dicek' },
  { key: 'error',      label: 'Gagal sync ke MEXC', hint: 'Suara alert — sama dengan duplikat' },
  { key: 'unpaid',     label: 'Belum bayar',        hint: 'Default MATI — terlalu sering, tidak ada keputusan' },
  { key: 'waiting',    label: 'Menunggu diproses',  hint: 'Default MATI' },
  { key: 'processing', label: 'Sedang diproses',    hint: 'Default MATI' },
];

/** Map an order state to its event key. */
const STATE_SOUND = {
  0: 'unpaid', 1: 'paid', 2: 'waiting', 3: 'processing',
  4: 'done', 5: 'cancelled', 6: 'invalid', 7: 'refused', 8: 'timeout',
  9: 'duplicate', // Banding (BingX appeal) — an alert, needs a human
  10: 'duplicate', // unknown BingX status — same alert
};
export function soundForState(state) {
  return STATE_SOUND[state] || null;
}

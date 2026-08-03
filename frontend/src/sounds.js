/**
 * Sound engine.
 *
 * Replaces the old beep() which had two problems:
 *  1. `type: 'square'` at 880–1320 Hz and volume 0.7–0.9 — square waves are all
 *     odd harmonics, which is exactly the piercing "cempreng" quality.
 *  2. A NEW AudioContext per beep, never closed. Browsers cap concurrent
 *     contexts (~6 in Chrome), so after a few dozen notifications sound just
 *     stops working with no error.
 *
 * This version: ONE shared context, sine partials through a lowpass filter,
 * soft attack + long exponential decay (bell/marimba character), low default
 * volume, and a distinct musical motif per event so you can tell what happened
 * without looking at the screen.
 */

const KEY = 'mexc_sound_prefs';

const DEFAULTS = {
  enabled: true,
  volume: 0.5,          // 0..1 master, scaled down internally (never harsh)
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
  },};

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

// ── Audio context (single instance, created lazily on first use) ────────────
let ctx = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Browsers suspend contexts created before a user gesture; resume silently.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Unlock audio on the first interaction so notifications aren't silently muted.
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/**
 * One short, crisp UI tone.
 *
 * Tuned for the character of a modern phone unlock confirmation: very short
 * (~0.15-0.3s), soft attack with no click, fast decay, glassy rather than
 * bell-like. Two of these in quick succession read as a single "event" the
 * ear can identify without being intrusive.
 */
function note(freq, { at = 0, dur = 0.22, gain = 1 } = {}) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + at;

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 5200;   // keeps it bright but never sharp
  filter.Q.value = 0.4;

  const env = c.createGain();
  const peak = Math.max(0.0001, 0.16 * prefs.volume * gain);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);  // crisp, click-free
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);  // quick fade

  filter.connect(env);
  env.connect(c.destination);

  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = freq;
  o1.connect(filter);
  o1.start(t0); o1.stop(t0 + dur + 0.03);

  // Faint upper partial — the bit that makes it read as "glassy" rather than
  // as a plain beep. Decays even faster than the fundamental.
  const o2 = c.createOscillator();
  const g2 = c.createGain();
  g2.gain.value = 0.12;
  o2.type = 'triangle';
  o2.frequency.value = freq * 3.02;
  o2.connect(g2); g2.connect(filter);
  o2.start(t0); o2.stop(t0 + dur * 0.4);
}

const N = { C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25,
            F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.5, G6: 1568.0 };

/**
 * One motif per order state, so you can tell what happened by ear alone.
 * They share the same short, glassy voice but differ in shape and register:
 *   rising      = something needs you
 *   flat/repeat = holding pattern
 *   falling     = closed, one way or another
 * The lower and slower it falls, the worse the outcome.
 */
const MOTIFS = {
  // ── Order states ──
  unpaid:     () => { note(N.D5, { dur: 0.20, gain: 0.85 }); },                                       // menunggu buyer bayar
  paid:       () => { note(N.C6, { dur: 0.14 }); note(N.G6, { at: 0.075, dur: 0.26, gain: 1.05 }); }, // uang masuk — giliran Anda
  waiting:    () => { note(N.A5, { dur: 0.13, gain: 0.8 }); note(N.A5, { at: 0.15, dur: 0.22, gain: 0.8 }); }, // dua ketuk datar
  processing: () => { note(N.G5, { dur: 0.13 }); note(N.B5, { at: 0.08, dur: 0.24 }); },              // naik kecil, sedang jalan
  done:       () => { note(N.E6, { dur: 0.13 }); note(N.C6, { at: 0.08, dur: 0.16 }); note(N.G5, { at: 0.17, dur: 0.34 }); }, // turun menutup
  cancelled:  () => { note(N.D5, { dur: 0.16, gain: 0.85 }); note(N.A4, { at: 0.09, dur: 0.30, gain: 0.85 }); },
  invalid:    () => { note(N.F5, { dur: 0.14, gain: 0.85 }); note(N.E5, { at: 0.10, dur: 0.30, gain: 0.8 }); },  // turun rapat
  refused:    () => { note(N.C5, { dur: 0.15, gain: 0.9 }); note(N.G4, { at: 0.10, dur: 0.32, gain: 0.85 }); },
  timeout:    () => { note(N.G4, { dur: 0.12, gain: 0.8 }); note(N.E4, { at: 0.10, dur: 0.14, gain: 0.8 }); note(N.C4, { at: 0.21, dur: 0.34, gain: 0.8 }); }, // tiga turun, paling rendah

  // ── Bukan status order ──
  newOrder:   () => { note(N.A5, { dur: 0.14 }); note(N.E6, { at: 0.075, dur: 0.26 }); },
  message:    () => { note(N.E6, { dur: 0.18, gain: 0.75 }); },
  duplicate:  () => { note(N.F5, { dur: 0.12 }); note(N.F5, { at: 0.14, dur: 0.26 }); },
  error:      () => { note(N.G4, { dur: 0.16, gain: 0.8 }); note(N.E4, { at: 0.1, dur: 0.28, gain: 0.7 }); },
};

/** Play an event sound, respecting mute + per-event toggles. */
export function playSound(event) {
  if (!prefs.enabled) return;
  if (prefs.events[event] === false) return;
  const m = MOTIFS[event];
  if (m) { try { m(); } catch { /* audio unavailable */ } }
}

/** Preview a sound from the settings UI, ignoring the per-event toggle. */
export function previewSound(event) {
  const m = MOTIFS[event];
  if (m) { try { m(); } catch { /* */ } }
}

export const SOUND_EVENTS = [
  { key: 'newOrder',   label: 'Order baru masuk',   hint: 'Nada naik' },
  { key: 'unpaid',     label: 'Belum bayar',        hint: 'Satu nada — menunggu buyer' },
  { key: 'paid',       label: 'Sudah bayar',        hint: 'Naik terang — giliran Anda release' },
  { key: 'waiting',    label: 'Menunggu diproses',  hint: 'Dua ketuk datar' },
  { key: 'processing', label: 'Sedang diproses',    hint: 'Naik kecil' },
  { key: 'done',       label: 'Selesai',            hint: 'Tiga nada turun menutup' },
  { key: 'cancelled',  label: 'Dibatalkan',         hint: 'Turun sedang' },
  { key: 'invalid',    label: 'Invalid',            hint: 'Turun rapat' },
  { key: 'refused',    label: 'Ditolak',            hint: 'Turun ke nada rendah' },
  { key: 'timeout',    label: 'Timeout',            hint: 'Tiga turun, paling rendah' },
  { key: 'message',    label: 'Pesan chat baru',    hint: 'Satu bel lembut' },
  { key: 'duplicate',  label: 'Nama KYC duplikat',  hint: 'Dua denyut' },
  { key: 'error',      label: 'Gagal sync ke MEXC', hint: 'Dua nada rendah' },
];

/** Map an order state to its own sound. Every state has one now. */
const STATE_SOUND = {
  0: 'unpaid', 1: 'paid', 2: 'waiting', 3: 'processing',
  4: 'done', 5: 'cancelled', 6: 'invalid', 7: 'refused', 8: 'timeout',
};
export function soundForState(state) {
  return STATE_SOUND[state] || null;
}

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
    paid: true,
    done: true,
    cancelled: true,
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
 * One soft bell note.
 * Fundamental + a quiet, slightly detuned octave partial gives a glassy
 * marimba tone. The lowpass removes any residual edge so it stays "adem"
 * even at higher pitches.
 */
function note(freq, { at = 0, dur = 0.9, gain = 1 } = {}) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + at;

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2600;
  filter.Q.value = 0.6;

  const env = c.createGain();
  // Master is deliberately low: 0.5 on the slider ≈ 0.11 linear gain.
  const peak = Math.max(0.0001, 0.22 * prefs.volume * gain);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);        // soft attack, no click
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);        // natural decay

  filter.connect(env);
  env.connect(c.destination);

  // Fundamental
  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = freq;
  o1.connect(filter);
  o1.start(t0); o1.stop(t0 + dur + 0.05);

  // Quiet octave partial (the "shimmer" that makes it read as a bell, not a beep)
  const o2 = c.createOscillator();
  const g2 = c.createGain();
  g2.gain.value = 0.18;
  o2.type = 'sine';
  o2.frequency.value = freq * 2.01; // slight detune = gentle movement
  o2.connect(g2); g2.connect(filter);
  o2.start(t0); o2.stop(t0 + dur * 0.6);
}

// Note frequencies (equal temperament)
const N = { D4: 293.66, F4: 349.23, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.5 };

/**
 * Motifs — each event has its own shape so it's identifiable by ear:
 *   rising  = something needs you
 *   falling = something finished / closed
 *   single  = minor event
 */
const MOTIFS = {
  // Order baru masuk — warm rising fifth, inviting
  newOrder:  () => { note(N.C5, { dur: 0.8 }); note(N.G5, { at: 0.14, dur: 1.1 }); },
  // Buyer sudah bayar — rising fourth, brighter: butuh aksi Anda (release)
  paid:      () => { note(N.G5, { dur: 0.7 }); note(N.C6, { at: 0.13, dur: 1.0, gain: 1.05 }); },
  // Order selesai — triad turun yang "menutup", terasa tuntas
  done:      () => { note(N.G5, { dur: 0.6 }); note(N.E5, { at: 0.12, dur: 0.7 }); note(N.C5, { at: 0.24, dur: 1.2 }); },
  // Batal / timeout / ditolak — turun pelan di register rendah, tidak bikin kaget
  cancelled: () => { note(N.A4, { dur: 0.7, gain: 0.85 }); note(N.F4, { at: 0.15, dur: 1.0, gain: 0.85 }); },
  // Pesan chat baru — satu bel lembut
  message:   () => { note(N.E6, { dur: 0.7, gain: 0.7 }); },
  // Nama KYC duplikat — dua denyut hangat, tegas tapi tidak melengking
  duplicate: () => { note(N.A4, { dur: 0.45 }); note(N.A4, { at: 0.22, dur: 0.8 }); note(N.D5, { at: 0.22, dur: 0.8, gain: 0.5 }); },
  // Gagal sync / error — dua nada rendah, tenang
  error:     () => { note(N.D4, { dur: 0.5, gain: 0.8 }); note(N.D4, { at: 0.18, dur: 0.8, gain: 0.6 }); },
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
  { key: 'newOrder',  label: 'Order baru masuk',       hint: 'Nada naik — ada order baru' },
  { key: 'paid',      label: 'Buyer sudah bayar',      hint: 'Nada naik terang — perlu Anda release' },
  { key: 'done',      label: 'Order selesai',          hint: 'Nada turun menutup — transaksi tuntas' },
  { key: 'cancelled', label: 'Batal / timeout / tolak', hint: 'Nada rendah turun — order gugur' },
  { key: 'message',   label: 'Pesan chat baru',        hint: 'Satu bel lembut' },
  { key: 'duplicate', label: 'Nama KYC duplikat',      hint: 'Dua denyut — kemungkinan 1 KTP banyak akun' },
  { key: 'error',     label: 'Gagal sync ke MEXC',     hint: 'Dua nada rendah' },
];

/** Map an order state transition to the right sound event. */
export function soundForState(state) {
  if (state === 1) return 'paid';
  if (state === 4) return 'done';
  if ([5, 6, 7, 8].includes(state)) return 'cancelled';
  return null; // 0/2/3 — intermediate, stay quiet to avoid noise
}

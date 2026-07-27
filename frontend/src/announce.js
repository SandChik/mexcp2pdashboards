/**
 * Cross-tab announcement guard.
 *
 * Toasts and sounds are per-tab by nature, so three open tabs meant hearing
 * the same alert three times. localStorage is shared across tabs of the same
 * browser, so the first tab to claim an event id wins and the others stay
 * quiet. Different devices still announce independently — that is wanted, you
 * are physically elsewhere.
 *
 * Not atomic across tabs, so a perfectly simultaneous race could let two
 * through. That is acceptable: the worst case is one extra toast, and polls
 * are naturally staggered. Nothing that costs money relies on this.
 */
const KEY = 'mexc_announced';
const PRUNE_AFTER = 120000;

export function shouldAnnounce(id, ttlMs = 20000) {
  try {
    const now = Date.now();
    const map = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(map)) if (now - map[k] > PRUNE_AFTER) delete map[k];
    if (map[id] && now - map[id] < ttlMs) { localStorage.setItem(KEY, JSON.stringify(map)); return false; }
    map[id] = now;
    localStorage.setItem(KEY, JSON.stringify(map));
    return true;
  } catch {
    return true; // private mode / quota — better a duplicate than silence
  }
}

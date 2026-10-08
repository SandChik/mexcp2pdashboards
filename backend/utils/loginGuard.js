/**
 * Login brute-force guard (v76).
 *
 * The dashboard is now reachable from the public internet (Tailscale Funnel),
 * so the login form is the only lock on the door. This keeps password guessing
 * to a crawl without adding a dependency:
 *
 *   - per IP:   max FAILS_PER_IP failed attempts per WINDOW_MS  → 429 for the rest of the window
 *   - global:   max FAILS_GLOBAL failed attempts per WINDOW_MS  → 429 for everyone (defeats
 *               guessing from many IPs; a legitimate user waits at most 15 min)
 *
 * Successful login clears that IP's counter. Everything is in memory — a
 * restart resets it, which is fine: the point is rate, not permanent bans.
 */
const WINDOW_MS   = Number(process.env.LOGIN_WINDOW_MS) || 15 * 60 * 1000;
const FAILS_PER_IP = Number(process.env.LOGIN_FAILS_PER_IP) || 5;
const FAILS_GLOBAL = Number(process.env.LOGIN_FAILS_GLOBAL) || 30;

const perIp = new Map(); // ip -> [timestamps of failures]
let globalFails = [];

function prune(arr, now) { return arr.filter(t => now - t < WINDOW_MS); }

function retryAfterSec(arr, now) {
  const oldest = Math.min(...arr);
  return Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
}

/** Returns null when allowed, or { retryAfter, scope } when blocked. */
function check(ip) {
  const now = Date.now();
  const mine = prune(perIp.get(ip) || [], now);
  perIp.set(ip, mine);
  globalFails = prune(globalFails, now);
  if (mine.length >= FAILS_PER_IP) return { retryAfter: retryAfterSec(mine, now), scope: 'ip' };
  if (globalFails.length >= FAILS_GLOBAL) return { retryAfter: retryAfterSec(globalFails, now), scope: 'global' };
  return null;
}

function fail(ip) {
  const now = Date.now();
  const mine = prune(perIp.get(ip) || [], now); mine.push(now); perIp.set(ip, mine);
  globalFails = prune(globalFails, now); globalFails.push(now);
  return { remaining: Math.max(0, FAILS_PER_IP - mine.length) };
}

function success(ip) { perIp.delete(ip); }

// Housekeeping so the map can't grow forever under a scan.
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of perIp) { const p = prune(arr, now); if (p.length === 0) perIp.delete(ip); else perIp.set(ip, p); }
}, 60 * 1000).unref();

module.exports = { check, fail, success, WINDOW_MS, FAILS_PER_IP, FAILS_GLOBAL };

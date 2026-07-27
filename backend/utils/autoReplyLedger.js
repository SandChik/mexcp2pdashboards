const fs = require('fs');
const path = require('path');

/**
 * Auto-reply claim ledger — shared by the HTTP route and the server worker so
 * there is only ONE arbiter of "has this reply already been sent".
 *
 * Node is single-threaded and every read-modify-write below is synchronous
 * with no await inside, so two concurrent claims cannot interleave.
 */

const LEDGER = path.join(__dirname, '../data/auto-reply-sent.json');
const TTL_MS = 14 * 86400000;

function read() { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; } }
function write(o) { try { fs.writeFileSync(LEDGER, JSON.stringify(o)); } catch {} }
const key = (mid, no, ruleId) => `${mid}:${no}:${ruleId}`;

function prune(led) {
  const cutoff = Date.now() - TTL_MS;
  for (const k of Object.keys(led)) if (led[k] < cutoff) delete led[k];
}

/** Returns the subset of ruleIds this caller is allowed to send. */
function claim(mid, advOrderNo, ruleIds) {
  const led = read();
  prune(led);
  const now = Date.now();
  const granted = [];
  for (const id of ruleIds) {
    const k = key(mid, advOrderNo, id);
    if (led[k]) continue;
    led[k] = now;
    granted.push(id);
  }
  write(led);
  return granted;
}

/** Hand a claim back after a failed send so it can be retried. */
function release(mid, advOrderNo, ruleIds) {
  const led = read();
  let n = 0;
  for (const id of ruleIds) {
    const k = key(mid, advOrderNo, id);
    if (led[k]) { delete led[k]; n++; }
  }
  if (n) write(led);
  return n;
}

module.exports = { claim, release };

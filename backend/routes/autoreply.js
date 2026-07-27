const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Auto-reply claim ledger.
 *
 * The browser used to track "already sent" in localStorage, which is per
 * device — two open dashboards each thought they were the first and both
 * sent, and an eviction from the capped local list could make one tab send
 * the same rule over and over.
 *
 * Here the server is the single authority: a (merchant, order, rule) triple
 * can be claimed exactly once. Node is single-threaded and the
 * read-filter-write below has no await inside it, so two simultaneous claims
 * from two devices cannot interleave — the second one sees the first's write.
 */

const LEDGER = path.join(__dirname, '../data/auto-reply-sent.json');
const TTL_MS = 14 * 86400000; // orders are long finished by then

function read() { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; } }
function write(o) { try { fs.writeFileSync(LEDGER, JSON.stringify(o)); } catch { /* best effort */ } }
const key = (mid, no, ruleId) => `${mid}:${no}:${ruleId}`;

function prune(led) {
  const cutoff = Date.now() - TTL_MS;
  let removed = 0;
  for (const k of Object.keys(led)) if (led[k] < cutoff) { delete led[k]; removed++; }
  return removed;
}

// POST /api/autoreply/:mid/claim  { advOrderNo, ruleIds: [] } -> { granted: [] }
// Only rule ids returned in `granted` may be sent by the caller.
router.post('/:mid/claim', authMiddleware, (req, res) => {
  const { advOrderNo, ruleIds } = req.body || {};
  if (!advOrderNo || !Array.isArray(ruleIds)) return res.status(400).json({ error: 'advOrderNo and ruleIds required' });

  const led = read();               // ─┐ atomic section: no await between
  prune(led);                       //  │ read and write, so a concurrent
  const now = Date.now();           //  │ claim from another device is
  const granted = [];               //  │ serialized behind this one.
  for (const id of ruleIds) {       //  │
    const k = key(req.params.mid, advOrderNo, id);
    if (led[k]) continue;           //  │ already claimed elsewhere
    led[k] = now;                   //  │
    granted.push(id);               //  │
  }                                 //  │
  write(led);                       // ─┘

  res.json({ granted });
});

// POST /api/autoreply/:mid/release { advOrderNo, ruleIds: [] }
// Give a claim back when the send failed, so it can be retried later.
router.post('/:mid/release', authMiddleware, (req, res) => {
  const { advOrderNo, ruleIds } = req.body || {};
  if (!advOrderNo || !Array.isArray(ruleIds)) return res.status(400).json({ error: 'advOrderNo and ruleIds required' });
  const led = read();
  let n = 0;
  for (const id of ruleIds) {
    const k = key(req.params.mid, advOrderNo, id);
    if (led[k]) { delete led[k]; n++; }
  }
  if (n) write(led);
  res.json({ released: n });
});

module.exports = router;

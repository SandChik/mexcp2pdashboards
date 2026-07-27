const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const { claim, release } = require('../utils/autoReplyLedger');

const router = express.Router();

/**
 * HTTP face of the auto-reply claim ledger. The implementation lives in
 * utils/autoReplyLedger so the server-side worker and this route share one
 * arbiter — two ledgers would defeat the whole point.
 */

// POST /api/autoreply/:mid/claim  { advOrderNo, ruleIds: [] } -> { granted: [] }
// Only rule ids returned in `granted` may be sent by the caller.
router.post('/:mid/claim', authMiddleware, (req, res) => {
  const { advOrderNo, ruleIds } = req.body || {};
  if (!advOrderNo || !Array.isArray(ruleIds)) return res.status(400).json({ error: 'advOrderNo and ruleIds required' });

  res.json({ granted: claim(req.params.mid, advOrderNo, ruleIds) });
});

// POST /api/autoreply/:mid/release { advOrderNo, ruleIds: [] }
// Give a claim back when the send failed, so it can be retried later.
router.post('/:mid/release', authMiddleware, (req, res) => {
  const { advOrderNo, ruleIds } = req.body || {};
  if (!advOrderNo || !Array.isArray(ruleIds)) return res.status(400).json({ error: 'advOrderNo and ruleIds required' });
  res.json({ released: release(req.params.mid, advOrderNo, ruleIds) });
});

module.exports = router;

const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const { recent } = require('../utils/audit');
const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.json({ entries: recent(Number(req.query.limit) || 200) });
});

module.exports = router;

const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../utils/crypto');

// Random per-install secret persisted outside the project. No hardcoded
// fallback: tokens can't be forged with a known/default key.
const JWT_SECRET = jwtSecret;

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authMiddleware, JWT_SECRET };

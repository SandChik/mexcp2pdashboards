const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { authMiddleware, JWT_SECRET } = require('../middleware/authMiddleware');

const router = express.Router();
const CONFIG_PATH = path.join(__dirname, '../data/config.json');

function getConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// POST /api/auth/setup - First time setup
router.post('/setup', (req, res) => {
  const { password } = req.body;
  const config = getConfig();

  if (config.appPassword !== '$2a$10$defaultHashedPasswordChangeMe') {
    return res.status(400).json({ error: 'App already set up' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  config.appPassword = hashed;
  saveConfig(config);

  const token = jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const config = getConfig();

  const valid = bcrypt.compareSync(password, config.appPassword);
  if (!valid) return res.status(401).json({ error: 'Invalid password' });

  const token = jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token });
});

// GET /api/auth/status - Check if app is set up
router.get('/status', (req, res) => {
  const config = getConfig();
  const isSetup = config.appPassword !== '$2a$10$defaultHashedPasswordChangeMe';
  res.json({ isSetup });
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const config = getConfig();

  const valid = bcrypt.compareSync(oldPassword, config.appPassword);
  if (!valid) return res.status(401).json({ error: 'Invalid old password' });

  config.appPassword = bcrypt.hashSync(newPassword, 10);
  saveConfig(config);
  res.json({ success: true });
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { authMiddleware, JWT_SECRET } = require('../middleware/authMiddleware');
const guard = require('../utils/loginGuard');
const { audit } = require('../utils/audit');

const router = express.Router();
const CONFIG_PATH = path.join(__dirname, '../data/config.json');
const PLACEHOLDER = '$2a$10$defaultHashedPasswordChangeMe';
// v76: installs created before usernames existed get this name; change it in
// Settings → Akun. Stored lower-cased; compared lower-cased.
const DEFAULT_USER = 'admin';

function getConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function saveConfig(config) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); }
const normUser = (u) => String(u || '').trim().toLowerCase();
const userOf = (config) => normUser(config.appUser) || DEFAULT_USER;
const isSetup = (config) => config.appPassword && config.appPassword !== PLACEHOLDER;

function validUsername(u) { return /^[a-z0-9._-]{3,32}$/.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 128; }

// Constant-time-ish compare for the username: compare hashes of equal work so a
// wrong username costs the same as a wrong password (no user enumeration).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function issueToken(username) {
  return jwt.sign({ auth: true, user: username }, JWT_SECRET, { expiresIn: '24h' });
}

// POST /api/auth/setup — first-run: choose username + password
router.post('/setup', (req, res) => {
  const config = getConfig();
  if (isSetup(config)) return res.status(400).json({ error: 'App already set up' });
  const username = normUser(req.body.username) || DEFAULT_USER;
  const { password } = req.body;
  if (!validUsername(username)) return res.status(400).json({ error: 'Username: 3–32 karakter, huruf kecil/angka/._-' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password minimal 8 karakter' });
  config.appUser = username;
  config.appPassword = bcrypt.hashSync(password, 10);
  saveConfig(config);
  audit({ action: 'auth_setup', user: username, ip: req.ip });
  res.json({ success: true, token: issueToken(username) });
});

// POST /api/auth/login — { username, password }. Older clients that send only a
// password are treated as the default user, so a half-updated deploy still works.
router.post('/login', (req, res) => {
  const ip = req.ip;
  const blocked = guard.check(ip);
  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfter));
    return res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(blocked.retryAfter / 60)} menit.`, retryAfter: blocked.retryAfter });
  }
  const config = getConfig();
  const username = normUser(req.body.username) || DEFAULT_USER;
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const userOk = username === userOf(config);
  // Always run one bcrypt compare so timing doesn't reveal whether the username matched.
  const passOk = bcrypt.compareSync(password, userOk ? config.appPassword : DUMMY_HASH) && userOk;
  if (!passOk) {
    const { remaining } = guard.fail(ip);
    audit({ action: 'auth_login_failed', user: username, ip, remaining });
    return res.status(401).json({ error: 'Username atau password salah', remaining });
  }
  guard.success(ip);
  audit({ action: 'auth_login', user: username, ip });
  res.json({ success: true, token: issueToken(username), user: username });
});

// GET /api/auth/status — set up yet? (never reveals the username)
router.get('/status', (req, res) => {
  const config = getConfig();
  res.json({ isSetup: !!isSetup(config) });
});

// GET /api/auth/me — who am I (for Settings → Akun)
router.get('/me', authMiddleware, (req, res) => {
  const config = getConfig();
  res.json({ user: userOf(config) });
});

// POST /api/auth/change-password — { oldPassword, newPassword }
router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const config = getConfig();
  if (!bcrypt.compareSync(String(oldPassword || ''), config.appPassword)) return res.status(401).json({ error: 'Password lama salah' });
  if (!validPassword(newPassword)) return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
  config.appPassword = bcrypt.hashSync(newPassword, 10);
  saveConfig(config);
  audit({ action: 'auth_password_changed', user: userOf(config), ip: req.ip });
  res.json({ success: true });
});

// POST /api/auth/change-username — { password, newUsername }
router.post('/change-username', authMiddleware, (req, res) => {
  const config = getConfig();
  const newUsername = normUser(req.body.newUsername);
  if (!bcrypt.compareSync(String(req.body.password || ''), config.appPassword)) return res.status(401).json({ error: 'Password salah' });
  if (!validUsername(newUsername)) return res.status(400).json({ error: 'Username: 3–32 karakter, huruf kecil/angka/._-' });
  const old = userOf(config);
  config.appUser = newUsername;
  saveConfig(config);
  audit({ action: 'auth_username_changed', from: old, to: newUsername, ip: req.ip });
  res.json({ success: true, user: newUsername, token: issueToken(newUsername) });
});

module.exports = router;

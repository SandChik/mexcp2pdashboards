const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keys live OUTSIDE the project folder so zipping/syncing the project never
// leaks them. On Windows this is C:\Users\<you>\.mexc-dashboard\
const KEY_DIR = path.join(os.homedir(), '.mexc-dashboard');
const DATA_KEY_PATH = path.join(KEY_DIR, 'data.key');   // 32 bytes for AES-256-GCM
const JWT_KEY_PATH  = path.join(KEY_DIR, 'jwt.key');    // random JWT signing secret

function ensureDir() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
}

function loadOrCreate(file, bytes, encoding) {
  ensureDir();
  if (fs.existsSync(file)) return fs.readFileSync(file, encoding ? 'utf8' : null);
  const val = encoding ? crypto.randomBytes(bytes).toString(encoding) : crypto.randomBytes(bytes);
  fs.writeFileSync(file, val, { mode: 0o600 });
  return val;
}

const dataKey = loadOrCreate(DATA_KEY_PATH, 32, null);          // Buffer
const jwtSecret = loadOrCreate(JWT_KEY_PATH, 48, 'hex');        // string

const PREFIX = 'enc:v1:';

// AES-256-GCM. Output: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>
function encryptSecret(plain) {
  if (plain == null || plain === '') return plain;
  if (String(plain).startsWith(PREFIX)) return plain; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map(b => b.toString('base64')).join(':');
}

// Pass-through for legacy plaintext values (smooth migration on next save).
function decryptSecret(stored) {
  if (stored == null || stored === '') return stored;
  if (!String(stored).startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const [ivB, tagB, ctB] = String(stored).slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return ''; // wrong key / corrupted — fail closed
  }
}

function isEncrypted(v) { return typeof v === 'string' && v.startsWith(PREFIX); }

module.exports = { encryptSecret, decryptSecret, isEncrypted, jwtSecret, KEY_DIR };

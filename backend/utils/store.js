const fs = require('fs');
const path = require('path');
const { encryptSecret, decryptSecret } = require('./crypto');

const DATA_DIR = path.join(__dirname, '../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// Bootstrap: the data directory is gitignored (it holds secrets & runtime
// data), so on a fresh deploy it won't exist. Create it + a default config
// (password = the well-known placeholder, which triggers first-run setup).
function ensureConfig() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      appPassword: '$2a$10$defaultHashedPasswordChangeMe',
      merchants: [],
    }, null, 2));
  }
}
ensureConfig();

function readConfig() {
  ensureConfig();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// Returns a merchant with apiSecret DECRYPTED, ready for signing API calls.
function getMerchant(id) {
  const m = readConfig().merchants.find(x => x.id === id);
  if (!m) return null;
  return { ...m, apiSecret: decryptSecret(m.apiSecret) };
}

module.exports = { readConfig, writeConfig, getMerchant, encryptSecret, decryptSecret, CONFIG_PATH };

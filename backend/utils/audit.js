const fs = require('fs');
const path = require('path');

// Append-only audit trail for sensitive actions (release, confirm, switch,
// ad changes). Plain JSONL — no native dependency, greppable, survives restart.
const LOG_PATH = path.join(__dirname, '../data/audit.log');

function audit(entry) {
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(LOG_PATH, line);
  } catch (e) { /* never let logging break a request */ }
}

function recent(n = 200) {
  try {
    const lines = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = { audit, recent };

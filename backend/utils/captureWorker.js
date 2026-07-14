const fs = require('fs');
const path = require('path');
const { readConfig, getMerchant } = require('./store');
const { captureFtdByOrderNos, captureBuyerLog, ACTIVE } = require('./captureCore');

/**
 * 24/7 capture worker.
 *
 * Runs INSIDE the backend process so FTD stats and the buyer log are captured
 * even when no browser tab is open. Strictly READ-ONLY against MEXC: it only
 * lists orders and reads order details — it never sends messages, never
 * releases coins, never touches ads. Auto-reply intentionally stays in the
 * browser under human supervision.
 *
 * Config (env):
 *   CAPTURE_WORKER=0            disable entirely
 *   CAPTURE_INTERVAL_MS=20000   per-cycle interval (min 10000)
 *
 * Per-merchant behavior:
 *   - FTD snapshots: always on (matches the dashboard's existing behavior).
 *   - Buyer log: only when that merchant's `buyerLog` setting is ON — the
 *     same toggle as in the panel's ⋮ menu.
 */

const SETTINGS_PATH = path.join(__dirname, '../data/merchant-settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; } }

let running = false;
let timer = null;

async function cycle() {
  if (running) return; // never overlap cycles
  running = true;
  try {
    const { fetchRecentOrders } = require('./captureCore');
    const merchants = (readConfig().merchants || []).map(m => getMerchant(m.id)).filter(Boolean);
    if (merchants.length === 0) return;
    const settings = readSettings();

    for (const merchant of merchants) {
      let orders;
      try { orders = await fetchRecentOrders(merchant, 24, 3); }
      catch (e) {
        console.error(`[worker] ${merchant.name}: order fetch failed —`, e.response?.data?.msg || e.message);
        continue; // one merchant failing must not stall the others
      }

      // FTD: snapshot in-progress SELL orders before MEXC hides their stats
      const activeSell = orders.filter(o => o.side === 'SELL' && ACTIVE.has(o._state)).map(o => o.advOrderNo);
      if (activeSell.length) {
        try {
          const r = await captureFtdByOrderNos(merchant, activeSell);
          if (r.captured) console.log(`[worker] ${merchant.name}: FTD snapshot +${r.captured}`);
        } catch (e) { console.error(`[worker] ${merchant.name}: ftd capture —`, e.message); }
      }

      // Buyer log: completed SELL orders, only if the merchant enabled it
      if (settings[merchant.id]?.buyerLog) {
        const doneSell = orders.filter(o => o.side === 'SELL' && o._state === 4).map(o => ({
          advOrderNo: o.advOrderNo,
          amount: parseFloat(o.amount) || 0,
          usdt: parseFloat(o.tradableQuantity) || 0,
          fiatUnit: o.fiatUnit || '',
          doneAt: o.updateTime || o.createTime || Date.now(),
        }));
        if (doneSell.length) {
          try {
            const r = await captureBuyerLog(merchant, doneSell);
            if (r.added) console.log(`[worker] ${merchant.name}: buyer log +${r.added}`);
          } catch (e) { console.error(`[worker] ${merchant.name}: buyer log —`, e.message); }
        }
      }
    }
  } catch (e) {
    console.error('[worker] cycle error:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (process.env.CAPTURE_WORKER === '0') { console.log('[worker] disabled via CAPTURE_WORKER=0'); return; }
  const interval = Math.max(10000, Number(process.env.CAPTURE_INTERVAL_MS) || 20000);
  console.log(`[worker] 24/7 capture worker ON — every ${interval / 1000}s (read-only: FTD + buyer log)`);
  timer = setInterval(cycle, interval);
  setTimeout(cycle, 3000); // first pass shortly after boot
}

function stop() { if (timer) clearInterval(timer); }

module.exports = { start, stop };

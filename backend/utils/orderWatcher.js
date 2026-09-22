const { readConfig, getMerchant } = require('./store');
const notifier = require('./notifier');

/**
 * Order watcher — the server-side eye that feeds notifications.
 *
 * Every INTERVAL it reads each merchant's quick order list through the same
 * cached path the browser uses (routes/orders.quickOrders), diffs it against
 * the previous pass and emits events. The first pass for a merchant only
 * records a baseline, so a restart never re-announces the whole list.
 *
 * Events (house states):
 *   newOrder  — an order id not seen before, currently running
 *   paid      — SELL order 0 → 1 (buyer paid; release is on us)
 *   cancelled — running → 5/6/7/8
 *   appeal    — → 9 (BingX appeal) or 10 (status the adapter doesn't know)
 *   done      — running → 4 (off by default)
 *   message   — unreadCount grew; at most one per order per 90s
 */
const INTERVAL_MS = Math.max(5000, parseInt(process.env.NOTIFY_INTERVAL_MS || '10000', 10));
const RUNNING = new Set([0, 1, 2, 3, 9, 10]);
const CANCELLED = new Set([5, 6, 7, 8]);
const MESSAGE_COOLDOWN_MS = 90000;

const prev = {};          // merchantId -> { orderNo: { state, unread } }
const primed = new Set();
const lastMsgAt = {};     // `${mid}:${orderNo}` -> ts
let timer = null, running = false;
const diag = { cycles: 0, lastCycleAt: null, lastError: null, emitted: 0, lastEvent: null };

async function cycle() {
  if (running) return;
  running = true;
  diag.cycles++; diag.lastCycleAt = Date.now();
  try {
    const { quickOrders } = require('../routes/orders');
    const merchants = (readConfig().merchants || []).map(m => getMerchant(m.id)).filter(Boolean);
    for (const m of merchants) {
      let list;
      try { list = await quickOrders(m); }
      catch (e) { diag.lastError = `${m.name}: ${e.response?.data?.msg || e.bingx?.msg || e.message}`; continue; }
      const orders = (Array.isArray(list) ? list : []).map(o => ({ ...o, _state: Number(o.state) }));
      const before = prev[m.id] || {};
      const after = {};
      orders.forEach(o => { after[o.advOrderNo] = { state: o._state, unread: Number(o.unreadCount) || 0 }; });

      if (!primed.has(m.id)) { primed.add(m.id); prev[m.id] = after; continue; }

      const events = [];
      for (const o of orders) {
        const b = before[o.advOrderNo];
        const s = o._state;
        if (!b) {
          if (RUNNING.has(s)) events.push({ type: 'newOrder', o });
          continue;
        }
        if (b.state !== s) {
          if (s === 1 && b.state === 0 && o.side === 'SELL') events.push({ type: 'paid', o });
          else if (CANCELLED.has(s) && RUNNING.has(b.state)) events.push({ type: 'cancelled', o });
          else if ((s === 9 || s === 10) && b.state !== 9 && b.state !== 10) events.push({ type: 'appeal', o });
          else if (s === 4 && RUNNING.has(b.state)) events.push({ type: 'done', o });
        }
        const unread = Number(o.unreadCount) || 0;
        if (unread > (b.unread || 0) && RUNNING.has(s)) {
          const key = `${m.id}:${o.advOrderNo}`;
          if (Date.now() - (lastMsgAt[key] || 0) > MESSAGE_COOLDOWN_MS) { lastMsgAt[key] = Date.now(); events.push({ type: 'message', o }); }
        }
      }
      prev[m.id] = { ...before, ...after };
      for (const ev of events) {
        try {
          await notifier.dispatch({ ...ev, merchant: m, url: '/queue' });
          diag.emitted++; diag.lastEvent = { at: Date.now(), type: ev.type, merchant: m.name, order: String(ev.o.advOrderNo).slice(-8) };
        } catch (e) { diag.lastError = `dispatch: ${e.message}`; }
      }
    }
  } finally { running = false; }
}

function start() {
  if (timer) return;
  console.log(`[notify] watcher ON — tiap ${INTERVAL_MS / 1000}s (siklus pertama hanya mencatat)`);
  setTimeout(cycle, 4000);
  timer = setInterval(cycle, INTERVAL_MS);
}
function stop() { clearInterval(timer); timer = null; }
function status() { return { ...diag, intervalMs: INTERVAL_MS, on: !!timer }; }

module.exports = { start, stop, status };

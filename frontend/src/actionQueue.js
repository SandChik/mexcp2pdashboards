import { merchantApi, ordersApi } from './api';
import { normalizeState } from './components/helpers';
import { actionFor } from './actions';

/**
 * Cross-merchant queue of orders waiting for the operator.
 *
 * One poller for the whole app (the sidebar badge and the queue page share
 * it), so adding the badge costs one request per merchant per cycle rather
 * than duplicating MerchantPanel's 5s polling.
 *
 * Only runs while something is subscribed — no background traffic on the
 * login screen.
 */

const POLL_MS = 15000;
const WINDOW_MS = 86400000; // 24h — actionable orders are minutes old, never days

let items = [];
let activeByMerchant = {};   // merchantId -> count of orders still running (state 0..3)
let merchants = [];
let listeners = [];
let timer = null;
let inFlight = false;
let lastError = false;
let lastSync = 0;

const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* */ } });

export function getQueue() { return items; }
export function getQueueCount() { return items.length; }
/** Running-order count per merchant — lets the dashboard badge every merchant
 *  chip so you can see where the activity is without opening each panel. */
export function getActiveByMerchant() { return activeByMerchant; }
export function getQueueMeta() { return { lastError, lastSync, merchants }; }

export async function refreshQueue() {
  if (inFlight) return;
  inFlight = true;
  try {
    if (merchants.length === 0) {
      const r = await merchantApi.list();
      merchants = r.data || [];
    }
    const now = Date.now();
    const results = await Promise.all(merchants.map(async (m) => {
      try {
        // Quick path: shares the server-side 3s cache with the panels' own
        // polling, so this poller usually costs ZERO extra MEXC requests.
        // Actionable orders have minute-scale deadlines — the 24h quick
        // window always contains them.
        const r = await ordersApi.marketQuick(m.id, { startTime: now - WINDOW_MS, endTime: now });
        const raw = r.data;
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        const norm = list.map(o => ({ ...o, _state: normalizeState(o.state), merchantId: m.id, merchantName: m.name }));
        return {
          mid: m.id,
          actionable: norm.filter(o => actionFor(o)),
          active: norm.filter(o => [0, 1, 2, 3].includes(o._state)).length,
        };
      } catch { return null; } // one merchant failing must not blank the queue
    }));

    if (results.every(r => r === null)) { lastError = true; emit(); return; }
    lastError = results.some(r => r === null);

    const nextActive = { ...activeByMerchant };
    results.forEach(r => { if (r) nextActive[r.mid] = r.active; });
    activeByMerchant = nextActive;

    items = results.filter(Boolean).flatMap(r => r.actionable).sort((a, b) => {
      // Soonest deadline first; orders without a deadline sink to the bottom.
      const da = a.payTimeLimit || Infinity, db = b.payTimeLimit || Infinity;
      if (da !== db) return da - db;
      return (b.createTime || 0) - (a.createTime || 0);
    });
    lastSync = Date.now();
    emit();
  } finally {
    inFlight = false;
  }
}

/** Drop an order from the queue immediately after a successful action, so the
 *  row disappears without waiting for the next poll. */
export function removeFromQueue(advOrderNo) {
  const before = items.length;
  items = items.filter(o => o.advOrderNo !== advOrderNo);
  if (items.length !== before) emit();
}

/** Force a merchant-list refetch (e.g. after adding/removing a merchant). */
export function resetQueueMerchants() { merchants = []; }

export function subscribeQueue(fn) {
  listeners.push(fn);
  if (!timer) {
    refreshQueue();
    timer = setInterval(refreshQueue, POLL_MS);
  }
  return () => {
    listeners = listeners.filter(l => l !== fn);
    if (listeners.length === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

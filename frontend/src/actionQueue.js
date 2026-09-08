import { merchantApi, ordersApi, registryApi } from './api';
import { announceOrderChanges } from './orderEvents';
import { normalizeState } from './components/helpers';
import { actionFor } from './actions';

/**
 * Cross-merchant list of orders that are still RUNNING (not finished).
 *
 * Two lists come out of one poll, on purpose:
 *   items           — every unfinished order (states 0..3). What the page shows.
 *   actionableCount — the subset the operator can act on right now. What the
 *                     sidebar badge shows.
 * Keeping them separate matters: a badge that counts orders you can't do
 * anything about stops meaning "there is work for me" and gets ignored.
 *
 * One poller for the whole app (the sidebar badge and the queue page share
 * it), so adding the badge costs one request per merchant per cycle rather
 * than duplicating MerchantPanel's 5s polling.
 *
 * Only runs while something is subscribed — no background traffic on the
 * login screen.
 */

const POLL_MS = 15000;
const WINDOW_MS = 86400000; // 24h — running orders are minutes old, never days
const RUNNING = [0, 1, 2, 3, 9];  // NOT_PAID, PAID, WAIT_PROCESS, PROCESSING, + BANDING (BingX appeal)
                               // 4..8 (DONE/CANCEL/INVALID/REFUSE/TIMEOUT) are
                               // finished and deliberately excluded — this is a
                               // work list, not a history page.

let items = [];
let actionableCount = 0;
let activeByMerchant = {};
let buyerLogOn = {};          // merchantId -> is the buyer-log/duplicate alert enabled
let nameIndex = {};           // normalised KYC name -> [advOrderNo] (across all merchants)
let nameIndexAt = 0;
const prevStates = {};        // merchantId -> { advOrderNo: state }
const prevUnread = {};        // merchantId -> { advOrderNo: unreadCount }
const seededMerchants = new Set();   // merchantId -> count of orders still running (state 0..3)
let merchants = [];
let listeners = [];
let timer = null;
let inFlight = false;
let lastError = false;
let lastSync = 0;

const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* */ } });

export function getQueue() { return items; }
export function getQueueCount() { return items.length; }
/** Orders the operator can act on RIGHT NOW — this is what the sidebar badge
 *  counts, never the full running list. */
export function getActionableCount() { return actionableCount; }
/** Running-order count per merchant — lets the dashboard badge every merchant
 *  chip so you can see where the activity is without opening each panel. */
export function getActiveByMerchant() { return activeByMerchant; }
export function getQueueMeta() { return { lastError, lastSync, merchants, buyerLogOn }; }
/** Permanent buyer-name index, shared so the queue page doesn't fetch its own. */
export function getNameIndex() { return nameIndex; }
/** Is the duplicate-name alert switched on for this merchant? */
export function isBuyerLogOn(mid) { return !!buyerLogOn[mid]; }

export async function refreshQueue() {
  if (inFlight) return;
  inFlight = true;
  try {
    if (merchants.length === 0) {
      const r = await merchantApi.list();
      merchants = r.data || [];
      // Which merchants have "Catat buyer & alert nama" ON. The duplicate badge
      // and its sound are gated on this, per merchant.
      await Promise.all(merchants.map(async m => {
        try { const s = await merchantApi.getSettings(m.id); buyerLogOn[m.id] = !!s.data?.buyerLog; }
        catch { /* leave as-is; a settings blip must not silence the queue */ }
      }));
    }

    // The buyer log is written by the server worker, so this tab never hears
    // about new entries by itself. Refresh periodically or a buyer whose first
    // order completed after page load would never raise the alert.
    if (Object.values(buyerLogOn).some(Boolean) && Date.now() - nameIndexAt > 45000) {
      try {
        const r = await registryApi.list(merchants[0].id, true);
        nameIndex = r.data?.nameIndex || nameIndex;
        nameIndexAt = Date.now();
      } catch { /* keep last */ }
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
        const norm = list.map(o => ({ ...o, _state: normalizeState(o.state), merchantId: m.id, merchantName: m.name, platform: m.platform || o.platform || 'mexc' }));
        // Announce over every order in the window, not just the running ones —
        // otherwise a transition INTO done/cancelled/timeout would be silent,
        // because those orders leave the running list at the same moment.
        const seeded = seededMerchants.has(m.id);
        const { states, unread } = announceOrderChanges({
          merchantId: m.id,
          merchantName: m.name,
          orders: norm,
          prevStates: prevStates[m.id] || {},
          prevUnread: prevUnread[m.id] || {},
          first: !seeded,
        });
        prevStates[m.id] = states; prevUnread[m.id] = unread;
        seededMerchants.add(m.id);

        const running = norm.filter(o => RUNNING.includes(o._state));
        return {
          mid: m.id,
          running,
          actionable: running.filter(o => actionFor(o)).length,
          active: running.length,
        };
      } catch { return null; } // one merchant failing must not blank the queue
    }));

    if (results.every(r => r === null)) { lastError = true; emit(); return; }
    lastError = results.some(r => r === null);

    const nextActive = { ...activeByMerchant };
    results.forEach(r => { if (r) nextActive[r.mid] = r.active; });
    activeByMerchant = nextActive;

    const ok = results.filter(Boolean);
    actionableCount = ok.reduce((n, r) => n + r.actionable, 0);
    items = ok.flatMap(r => r.running).sort((a, b) => {
      // Orders needing action first — the whole point of the page is that the
      // work sits at the top and the merely-running orders sit below it.
      const aa = actionFor(a) ? 0 : 1, ab = actionFor(b) ? 0 : 1;
      if (aa !== ab) return aa - ab;
      // Then soonest deadline; orders without a deadline sink to the bottom.
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

/**
 * Reflect a successful action locally so the row updates instantly instead of
 * waiting up to POLL_MS.
 *
 * The two actions end differently and must NOT be treated the same:
 *   release — the order is finished, so it leaves the list.
 *   confirm — we only marked OUR payment; the order is still running and now
 *             waits for the counterpart to release. Removing it would make the
 *             row vanish and then reappear at the next poll.
 */
export function applyActionLocally(advOrderNo, action) {
  const before = items;
  if (action === 'confirm') {
    items = items.map(o => o.advOrderNo === advOrderNo ? { ...o, state: 1, _state: 1 } : o);
  } else {
    items = items.filter(o => o.advOrderNo !== advOrderNo);
  }
  actionableCount = items.filter(o => actionFor(o)).length;
  if (items !== before) emit();
}

/** Kept for callers that just want the row gone (e.g. an order that turned out
 *  to be finished already). */
export function removeFromQueue(advOrderNo) {
  applyActionLocally(advOrderNo, 'release');
}

/** Force a merchant-list refetch (e.g. after adding/removing a merchant). */
export function resetQueueMerchants() { merchants = []; buyerLogOn = {}; nameIndexAt = 0; }

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

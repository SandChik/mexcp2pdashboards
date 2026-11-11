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

const POLL_MS = 5000; // same cadence as the panels; they share the server's 3s cache, so this is nearly free
const WINDOW_MS = 86400000; // 24h — running orders are minutes old, never days
const RUNNING = [0, 1, 2, 3, 9, 10];  // NOT_PAID, PAID, WAIT_PROCESS, PROCESSING, + BANDING (BingX appeal), + unknown BingX status
                               // 4..8 (DONE/CANCEL/INVALID/REFUSE/TIMEOUT) are
                               // finished and deliberately excluded — this is a
                               // work list, not a history page.

let items = [];
let actionableCount = 0;
let activeByMerchant = {};
let buyerLogOn = {};          // merchantId -> is the buyer-log/duplicate alert enabled
let nameIndex = {};           // merchantId -> { normalised KYC name -> [advOrderNo] } — that merchant's chosen sources (v81)
let nameIndexAt = 0;
const prevStates = {};        // merchantId -> { advOrderNo: state }
const prevUnread = {};        // merchantId -> { advOrderNo: unreadCount }
const seededMerchants = new Set();   // merchantId -> count of orders still running (state 0..3)
let merchants = [];
let merchantsAt = 0;           // when the merchant list was last fetched
const MERCHANTS_TTL_MS = 60000; // re-read it every minute — a merchant added in Settings must show up
let listeners = [];
let timer = null;
let inFlight = false;          // any merchant poll running (spinner)
let forceNext = false;        // next pass bypasses the server's 3s cache (manual refresh)
const STUCK_MS = 30000;       // a pass older than this is presumed hung (network) and abandoned
let lastError = false;
let lastSync = 0;
let announcing = false;       // true while THIS poller announces, so its own broadcast doesn't re-trigger it

// Actions applied locally, with a timestamp. For a short grace period the
// server snapshot is corrected against this: the exchange can still report a
// just-released order as PAID for a second or two, and without this the very
// next refresh put the row straight back until the poll after that.
const recentLocal = new Map();  // advOrderNo -> { action, at }
const LOCAL_GRACE_MS = 60000;
// Orders ANY source has already reported as finished (done/cancelled/timeout…).
// Exchanges are eventually consistent: one snapshot says "done", the next
// (from another poller, or a manual refresh) says "paid" again. Once finished
// is finished — for ten minutes such an order is never shown running again.
const knownTerminal = new Map(); // advOrderNo -> at
const TERMINAL_TTL_MS = 10 * 60000;
function noteTerminal(list) {
  const now = Date.now();
  list.forEach(o => { if (!RUNNING.includes(o._state)) knownTerminal.set(o.advOrderNo, now); });
  for (const [no, at] of knownTerminal) if (now - at > TERMINAL_TTL_MS) knownTerminal.delete(no);
}
function reconcile(list) {
  const now = Date.now();
  for (const [no, v] of recentLocal) if (now - v.at > LOCAL_GRACE_MS) recentLocal.delete(no);
  return list.flatMap(o => {
    if (knownTerminal.has(o.advOrderNo) && RUNNING.includes(o._state)) return [];      // resurrected by a stale snapshot → drop
    const r = recentLocal.get(o.advOrderNo);
    if (!r) return [o];
    if (r.action === 'release') return RUNNING.includes(o._state) ? [] : [o];           // server still says running → trust ourselves
    if (r.action === 'confirm' && o._state === 0) return [{ ...o, state: 1, _state: 1 }]; // we paid; don't show "confirm" again
    return [o];
  });
}
function sortItems(list) {
  return list.slice().sort((a, b) => {
    const aa = actionFor(a) ? 0 : 1, ab = actionFor(b) ? 0 : 1;
    if (aa !== ab) return aa - ab;
    const da = a.payTimeLimit || Infinity, db = b.payTimeLimit || Infinity;
    if (da !== db) return da - db;
    return (b.createTime || 0) - (a.createTime || 0);
  });
}

/**
 * Push path: a panel that has just fetched a merchant's orders hands the list
 * straight to the queue. No second request, no cache, no waiting for a tick —
 * the queue shows exactly what the panel shows, at the same instant. Rows for
 * orders the panel didn't include (outside its date range) are left alone;
 * the poll keeps those honest.
 */
export function ingestOrders(merchantId, merchantName, platform, list) {
  if (!merchantId || !Array.isArray(list)) return;
  const norm = list.map(o => ({ ...o, _state: normalizeState(o._state ?? o.state), merchantId, merchantName, platform: platform || o.platform || 'mexc' }));
  noteTerminal(norm);
  const running = reconcile(norm.filter(o => RUNNING.includes(o._state)));
  const seen = new Set(norm.map(o => o.advOrderNo));
  const kept = items.filter(o => !(o.merchantId === merchantId && seen.has(o.advOrderNo)) && !(o.merchantId === merchantId && !RUNNING.includes(o._state)));
  // A row this merchant had in the queue but the panel no longer lists as
  // running is finished (the panel's list always contains every running order).
  const stillRunning = kept.filter(o => o.merchantId !== merchantId || running.some(r => r.advOrderNo === o.advOrderNo) || !seen.has(o.advOrderNo));
  items = sortItems(stillRunning.concat(running));
  actionableCount = items.filter(o => actionFor(o)).length;
  activeByMerchant = { ...activeByMerchant, [merchantId]: items.filter(o => o.merchantId === merchantId).length };
  // The panel already announced this batch; record it as our baseline too so
  // our own next poll doesn't re-announce the same transition.
  const st = {}; const un = {};
  norm.forEach(o => { st[o.advOrderNo] = o._state; un[o.advOrderNo] = o.unreadCount || 0; });
  prevStates[merchantId] = { ...(prevStates[merchantId] || {}), ...st };
  prevUnread[merchantId] = { ...(prevUnread[merchantId] || {}), ...un };
  seededMerchants.add(merchantId);
  lastSync = Date.now();
  emit();
}

const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* */ } });

export function getQueue() { return items; }
export function getQueueCount() { return items.length; }
/** Orders the operator can act on RIGHT NOW — this is what the sidebar badge
 *  counts, never the full running list. */
export function getActionableCount() { return actionableCount; }
/** Running-order count per merchant — lets the dashboard badge every merchant
 *  chip so you can see where the activity is without opening each panel. */
export function getActiveByMerchant() { return activeByMerchant; }
export function getQueueMeta() { return { lastError, lastSync, merchants, buyerLogOn, inFlight }; }
/** Permanent buyer-name index per merchant ({ merchantId: { name: [orderNo] } }),
 *  shared so the queue page doesn't fetch its own. */
export function getNameIndex() { return nameIndex; }
/** Is the duplicate-name alert switched on for this merchant? */
export function isBuyerLogOn(mid) { return !!buyerLogOn[mid]; }

/** Settings calls this after adding/editing/removing a merchant, so the next
 *  poll picks the change up immediately instead of on the minute. */
export function invalidateQueueMerchants() { merchantsAt = 0; loadMerchants().catch(() => {}); }

// ── Poll: every merchant on its own clock (v84) ──────────────────────────
// The queue used to fetch all merchants with one Promise.all and only redraw
// when the SLOWEST had answered. Gate's quick list is 3 calls + unread
// lookups, MEXC shares a global rate gate with the server workers — so a BingX
// order that had already arrived sat invisible for seconds, while the BingX
// dashboard (which waits for nobody) showed it at once. Now each merchant's
// rows are applied the moment ITS fetch returns, and a slow merchant only
// delays its own next poll.
const mInFlight = {};   // merchantId -> started at
const mRerun = {};      // merchantId -> 'fresh' | true  (asked again while running)
const mFailed = {};     // merchantId -> last poll failed
let merchantsPromise = null;
let nameIndexPromise = null;

function loadMerchants() {
  if (!merchantsPromise) {
    merchantsPromise = (async () => {
      // The list used to be fetched ONCE per tab. A BingX merchant added in
      // Settings therefore never got polled until a full page reload — its
      // orders showed in the panel but never in the queue.
      const r = await merchantApi.list();
      merchants = r.data || [];
      merchantsAt = Date.now();
      const ids = new Set(merchants.map(m => m.id));
      const before = items.length;
      items = items.filter(o => ids.has(o.merchantId));           // a removed merchant's rows go too
      if (items.length !== before) actionableCount = items.filter(o => actionFor(o)).length;
      // Which merchants have "Catat buyer & alert nama" ON. The duplicate badge
      // and its sound are gated on this, per merchant.
      await Promise.all(merchants.map(async m => {
        try { const s = await merchantApi.getSettings(m.id); buyerLogOn[m.id] = !!s.data?.buyerLog; }
        catch { /* leave as-is; a settings blip must not silence the queue */ }
      }));
    })().finally(() => { merchantsPromise = null; });
  }
  return merchantsPromise;
}

// The buyer log is written by the server worker, so this tab never hears
// about new entries by itself. Refresh periodically or a buyer whose first
// order completed after page load would never raise the alert.
// One index per merchant with the alert on, built from the sources chosen
// for it in Settings → Catatan Buyer (server-side; default = itself + imports).
function refreshNameIndex() {
  if (nameIndexPromise || !Object.values(buyerLogOn).some(Boolean) || Date.now() - nameIndexAt <= 45000) return;
  nameIndexPromise = (async () => {
    const next = {};
    let ok = true;
    await Promise.all(merchants.filter(m => buyerLogOn[m.id]).map(async m => {
      try { const r = await registryApi.list(m.id); next[m.id] = r.data?.nameIndex || {}; }
      catch { ok = false; next[m.id] = nameIndex[m.id] || {}; /* keep last */ }
    }));
    nameIndex = next;
    if (ok) nameIndexAt = Date.now();
    emit();
  })().finally(() => { nameIndexPromise = null; });
}

function syncFlags() {
  inFlight = Object.keys(mInFlight).length > 0;
  lastError = merchants.some(m => mFailed[m.id]);
}

/** Replace ONE merchant's rows with a fresh snapshot and redraw now. */
function applyMerchant(mid, running) {
  items = sortItems(items.filter(o => o.merchantId !== mid).concat(running));
  actionableCount = items.filter(o => actionFor(o)).length;
  activeByMerchant = { ...activeByMerchant, [mid]: running.length };
  lastSync = Date.now();
}

async function pollMerchant(m, fresh) {
  const since = mInFlight[m.id];
  if (since && Date.now() - since < STUCK_MS) {
    // Coalesce: one more poll of THIS merchant after the current one. A poll
    // older than STUCK_MS is a hung request — abandon it and start over.
    mRerun[m.id] = fresh || mRerun[m.id] === 'fresh' ? 'fresh' : true;
    return;
  }
  const token = Date.now();
  mInFlight[m.id] = token;
  syncFlags(); emit(); // spinner on
  try {
    // Quick path: shares the server-side 3s cache with the panels' own
    // polling, so this poller usually costs ZERO extra exchange requests.
    // Actionable orders have minute-scale deadlines — the 24h quick window
    // always contains them.
    const now = Date.now();
    const r = await ordersApi.marketQuick(m.id, { startTime: now - WINDOW_MS, endTime: now, ...(fresh ? { fresh: 1 } : {}) }, { timeout: 20000 });
    if (mInFlight[m.id] !== token) return; // abandoned as stuck; a newer poll owns this merchant
    const raw = r.data;
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    const norm = list.map(o => ({ ...o, _state: normalizeState(o.state), merchantId: m.id, merchantName: m.name, platform: m.platform || o.platform || 'mexc' }));
    // Announce over every order in the window, not just the running ones —
    // otherwise a transition INTO done/cancelled/timeout would be silent,
    // because those orders leave the running list at the same moment.
    announcing = true;
    try {
      const { states, unread } = announceOrderChanges({
        merchantId: m.id,
        merchantName: m.name,
        orders: norm,
        prevStates: prevStates[m.id] || {},
        prevUnread: prevUnread[m.id] || {},
        first: !seededMerchants.has(m.id),
      });
      prevStates[m.id] = states; prevUnread[m.id] = unread;
    } finally { announcing = false; }
    seededMerchants.add(m.id);

    noteTerminal(norm);
    applyMerchant(m.id, reconcile(norm.filter(o => RUNNING.includes(o._state))));
    mFailed[m.id] = false;
  } catch {
    if (mInFlight[m.id] === token) mFailed[m.id] = true; // one merchant failing keeps its previous rows and blanks nothing
  } finally {
    if (mInFlight[m.id] === token) delete mInFlight[m.id];
    syncFlags(); emit();
    if (mRerun[m.id] && !mInFlight[m.id]) {
      const again = mRerun[m.id] === 'fresh';
      delete mRerun[m.id];
      pollMerchant(m, again);
    }
  }
}

export async function refreshQueue(opts = {}) {
  if (opts && opts.force) forceNext = true;
  const fresh = forceNext; forceNext = false;
  try {
    if (merchants.length === 0) await loadMerchants();                       // first run: need the list
    else if (Date.now() - merchantsAt > MERCHANTS_TTL_MS) loadMerchants().catch(() => {}); // later: refresh in the background
  } catch { lastError = true; emit(); return; }
  refreshNameIndex();
  await Promise.all(merchants.map(m => pollMerchant(m, fresh)));
}

// ── Push, not just poll ──────────────────────────────────────────────────
// Panels broadcast when they see a change; every successful action broadcasts
// too. Both make the queue re-read at once (debounced so a burst of panel
// events — three merchants polling at the same second — costs one refresh).
let kick = null;
function kickRefresh() { clearTimeout(kick); kick = setTimeout(refreshQueue, 250); }
if (typeof window !== 'undefined') {
  window.addEventListener('p2p:orders-changed', () => { if (!announcing) kickRefresh(); });
  window.addEventListener('p2p:action-done', (e) => {
    const { advOrderNo, kind } = e.detail || {};
    if (advOrderNo) applyActionLocally(advOrderNo, kind);  // row gone / flipped NOW, from any screen
    kickRefresh();
  });
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
  recentLocal.set(advOrderNo, { action, at: Date.now() });
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
/** Settings → Catatan Buyer changed a merchant's sources: re-read the name index on the next pass. */
export function invalidateNameIndex() { nameIndexAt = 0; }

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

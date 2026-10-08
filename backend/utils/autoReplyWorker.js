const fs = require('fs');
const path = require('path');
const { readConfig, getMerchant } = require('./store');
const { mexcGet, mexcPost } = require('./mexcApi');
const { fetchRecentOrders, normState } = require('./captureCore');
const wsManager = require('./wsManager');
const { claim, release } = require('./autoReplyLedger');
const { audit } = require('./audit');
const bx = require('./bingxOrders');
const bxChat = require('./bingxChat');
const verify = require('./verifyChat');

/**
 * Auto-reply worker.
 *
 * Moved off the browser on purpose: the tab version only ran while a dashboard
 * was open (phone tabs get suspended within minutes), and two open dashboards
 * meant two independent senders. Here there is exactly ONE sender, always on.
 *
 * This is the only part of the system that writes to buyers, so it is wrapped
 * in three independent guards:
 *   1. First cycle after boot NEVER sends — it only records current states.
 *      Otherwise a restart would re-greet every order still on the books.
 *   2. Every (order, rule) must be granted by the claim ledger, once, ever.
 *   3. Immediately before sending, the conversation is re-read: if that exact
 *      text is already there from us, it is skipped.
 *
 * Kill switch: AUTO_REPLY_WORKER=0
 */

const STATE_PATH = path.join(__dirname, '../data/order-states.json');
// v77: which verification chat events (file/pass/fail) each order has already
// produced — survives restarts so an old PASS can't re-fire after a deploy.
const VERIFY_PATH = path.join(__dirname, '../data/verify-seen.json');
const VERIFY_SCAN_MAX = 10;   // chat histories read per merchant per cycle
const { readSettings: readMerchantSettings, effectiveSettings } = require('./merchantSettings');
const INTERVAL_MS = Math.max(10000, Number(process.env.AUTO_REPLY_INTERVAL_MS) || 15000);
const GAP_MS = 900;           // spacing between two messages to the same buyer
const MAX_PER_CYCLE = 12;     // hard ceiling: a bug can never fan out unbounded

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function writeJson(p, o) { try { fs.writeFileSync(p, JSON.stringify(o)); } catch {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));

let running = false;
let timer = null;
const primed = new Set();   // merchantIds whose baseline states are recorded
const startedAt = Date.now();
// Per-merchant diagnostics for Settings → Pesan ("why didn't it send?").
const diag = {};            // merchantId -> { ... }
function d(mid) { return diag[mid] || (diag[mid] = { cycles: 0, sent: 0, lastCycleAt: null, ordersSeen: 0, running: 0, rulesActive: 0, primedAt: null, lastMatch: null, lastSentAt: null, lastError: null, skipped: null, transitions: [], verifyEvents: [] }); }
// v76: remember the last state hops per merchant (newest first) so the Settings
// screen can show what a verification order ACTUALLY did (2 → 0? 2 → 3?).
function noteTransition(dg, o, from, to) {
  dg.transitions.unshift({ at: Date.now(), advOrderNo: o.advOrderNo, side: o.side, from, to });
  if (dg.transitions.length > 20) dg.transitions.length = 20;
}
function status(mid) {
  const x = d(mid);
  return { ...x, workerOn: process.env.AUTO_REPLY_WORKER !== '0', intervalMs: INTERVAL_MS, uptimeMs: Date.now() - startedAt, primed: primed.has(mid) };
}

/** Resolve conversation id for an order, then ensure a live socket.
 *  BingX: the order number is the room and there is no socket — REST only. */
async function openChat(merchant, advOrderNo) {
  if (bx.isBingx(merchant)) return String(advOrderNo);
  const cr = await mexcGet('/api/v3/fiat/retrieveChatConversation', { orderNo: advOrderNo }, merchant.apiKey, merchant.apiSecret);
  const cid = cr?.data?.conversationId ?? cr?.conversationId;
  if (!cid) throw new Error('no conversationId');

  if (!wsManager.status(merchant.id, cid)?.connected) {
    const lk = await mexcPost('/api/v3/userDataStream', {}, merchant.apiKey, merchant.apiSecret);
    if (!lk.listenKey) throw new Error('no listenKey');
    const refresher = async () => (await mexcPost('/api/v3/userDataStream', {}, merchant.apiKey, merchant.apiSecret)).listenKey;
    await wsManager.connect(merchant.id, cid, lk.listenKey, refresher);
  }
  return cid;
}

/** True when this exact text is already in the conversation, sent by us. */
async function alreadySaid(merchant, cid, text) {
  if (bx.isBingx(merchant)) {
    try {
      const msgs = await bxChat.history(merchant, cid, 30);
      const target = text.trim();
      return msgs.some(m => m.self && String(m.content || '').trim() === target);
    } catch { return false; } // can't verify → the claim ledger is still in force
  }
  try {
    const h = await mexcGet('/api/v3/fiat/retrieveChatMessageWithPagination',
      { conversationId: cid, page: 1, limit: 30, sort: 'DESC' }, merchant.apiKey, merchant.apiSecret);
    const msgs = h?.data?.messages || [];
    const target = text.trim();
    return msgs.some(m => m.self && String(m.content || '').trim() === target);
  } catch {
    return false; // can't verify → the claim ledger is still in force
  }
}

// States that mean "this order did not go through": a WAIT_PROCESS order that
// lands here was REFUSED/cancelled, not verified.
const FAILED = new Set([5, 6, 7, 8]);
const VERIFY_PENDING = 2; // WAIT_PROCESS
const VERIFY_RULE_STATES = new Set(Object.values(verify.RULE_STATE)); // -3 file, -2 pass, -4 fail

/** Which rules fire for this order's STATE transition. */
function matchRules(rules, order, prevState, isNew) {
  const hits = (rules || []).filter(rule => {
    if (!rule.message || !rule.message.trim()) return false;
    if (rule.side !== 'ANY' && rule.side !== order.side) return false;
    if (rule.state === -1) return isNew;                    // "order baru masuk"
    if (rule.state === -2) {
      // "Verifikasi diterima" also accepts the rare WAIT_PROCESS → non-failed
      // hop (ad types that do route through state 2). The usual path is the
      // chat PASS event, handled by matchVerifyRules.
      return !isNew && prevState === VERIFY_PENDING && order._state !== VERIFY_PENDING && !FAILED.has(order._state) && order._state !== 9 && order._state !== 10;
    }
    if (VERIFY_RULE_STATES.has(rule.state)) return false;   // chat-driven, never by state
    if (rule.state !== order._state) return false;
    return isNew || prevState !== order._state;             // only on ENTERING the state
  });
  // When "Verifikasi diterima" fires, it IS the greeting for this hop — a plain
  // "Belum bayar" rule entering NOT_PAID at the same moment would double-text.
  if (hits.some(r => r.state === -2)) return hits.filter(r => r.state === -2 || r.state < 0);
  return hits;
}

/** Which rules fire for a verification CHAT event (kind: file | pass | fail). */
function matchVerifyRules(rules, order, kind) {
  const want = verify.RULE_STATE[kind];
  if (want === undefined) return [];
  return (rules || []).filter(rule => rule.message && rule.message.trim() && rule.state === want && (rule.side === 'ANY' || rule.side === order.side));
}

/** conversationId per order, cached — the worker reads history every cycle. */
const cidCache = new Map();
async function conversationIdOf(merchant, advOrderNo) {
  const k = `${merchant.id}:${advOrderNo}`;
  if (cidCache.has(k)) return cidCache.get(k);
  const cr = await mexcGet('/api/v3/fiat/retrieveChatConversation', { orderNo: advOrderNo }, merchant.apiKey, merchant.apiSecret);
  const cid = cr?.data?.conversationId ?? cr?.conversationId;
  if (!cid) throw new Error('no conversationId');
  cidCache.set(k, cid);
  if (cidCache.size > 500) cidCache.delete(cidCache.keys().next().value);
  return cid;
}

/**
 * Read the chat of running MEXC SELL orders and return the verification
 * events not seen before: [{ order, kind, key, createTime }]. `seen` is
 * mutated (per order: { file, pass, fail, other }) and persisted by the caller.
 */
async function scanVerifyEvents(merchant, orders, seen, dg) {
  const out = [];
  const candidates = orders.filter(o => o.side === 'SELL' && [0, 1, 2].includes(o._state)).slice(0, VERIFY_SCAN_MAX);
  for (const o of candidates) {
    let msgs;
    try {
      const cid = await conversationIdOf(merchant, o.advOrderNo);
      const h = await mexcGet('/api/v3/fiat/retrieveChatMessageWithPagination',
        { conversationId: cid, page: 1, limit: 30, sort: 'DESC' }, merchant.apiKey, merchant.apiSecret);
      msgs = h?.data?.messages || [];
    } catch (e) { dg.lastError = `verif-scan ${String(o.advOrderNo).slice(-6)}: ${e.message}`; continue; }
    const have = seen[o.advOrderNo] || (seen[o.advOrderNo] = {});
    have._t = Date.now(); // last touched — pruned after 3 days (see cycle)
    for (const ev of verify.eventsOf(msgs)) {
      const slot = ev.kind === 'other' ? `other:${ev.key}` : ev.kind;
      if (have[slot]) continue;
      have[slot] = ev.createTime || Date.now();
      out.push({ order: o, kind: ev.kind, key: ev.key, createTime: ev.createTime });
    }
  }
  return out;
}

/**
 * Send `matched` rules to one order, through the three guards. Returns how
 * many messages went out. Shared by state-driven and chat-driven triggers.
 */
async function deliver(merchant, o, matched, dg, budget) {
  // Guard 2: the ledger grants each (order, rule) exactly once, ever.
  const granted = claim(merchant.id, o.advOrderNo, matched.map(r => r.id));
  if (granted.length === 0) { dg.lastMatch.result = 'sudah pernah dikirim (ledger)'; return 0; }

  let cid;
  try { cid = await openChat(merchant, o.advOrderNo); }
  catch (e) {
    release(merchant.id, o.advOrderNo, granted); // retry next cycle
    dg.lastError = `chat: ${e.message}`; dg.lastMatch.result = dg.lastError;
    console.error(`[autoreply] ${merchant.name} ${o.advOrderNo}: chat gagal —`, e.message);
    return 0;
  }

  let sent = 0;
  for (const rule of matched.filter(r => granted.includes(r.id))) {
    if (sent >= budget) { release(merchant.id, o.advOrderNo, [rule.id]); continue; }
    // Guard 3: check the conversation itself right before sending.
    if (await alreadySaid(merchant, cid, rule.message)) { dg.lastMatch.result = 'teks yang sama sudah ada di chat'; continue; }
    let r;
    if (bx.isBingx(merchant)) {
      try { r = await bxChat.sendText(merchant, cid, rule.message); }
      catch (e) { r = { success: false, error: e.bingx?.msg || e.message }; }
    } else {
      r = wsManager.send(merchant.id, cid, rule.message);
    }
    if (r?.success) {
      sent++; dg.sent++; dg.lastSentAt = Date.now(); dg.lastMatch.result = 'terkirim';
      console.log(`[autoreply] ${merchant.name} → ${o.userInfo?.nickName || o.advOrderNo} (${rule.id})`);
      audit({ action: 'auto_reply_sent', merchantId: merchant.id, merchantName: merchant.name, advOrderNo: o.advOrderNo, ruleId: rule.id });
    } else {
      release(merchant.id, o.advOrderNo, [rule.id]);
      dg.lastError = `kirim: ${r?.error}`; dg.lastMatch.result = dg.lastError;
      console.error(`[autoreply] ${merchant.name} ${o.advOrderNo}: kirim gagal —`, r?.error);
    }
    await sleep(GAP_MS);
  }
  return sent;
}

async function cycle() {
  if (running) return;
  running = true;
  let sentThisCycle = 0;
  try {
    // Both platforms. BingX: orders via bingxOrders.fetchQuick (running + latest
    // ended), chat via REST (history to double-check, sendMsg to send).
    const merchants = (readConfig().merchants || []).map(m => getMerchant(m.id)).filter(Boolean);
    if (merchants.length === 0) return;
    const settings = readSettingsSafe();
    const states = readJson(STATE_PATH);
    const verifySeen = readJson(VERIFY_PATH);
    let notifier = null;
    try { notifier = require('./notifier'); } catch { /* notifications optional */ }

    for (const merchant of merchants) {
      const dg = d(merchant.id);
      dg.cycles++; dg.lastCycleAt = Date.now(); dg.skipped = null;
      // Defaults filled in — the same rules the Settings screen shows as active.
      const cfg = effectiveSettings(settings, merchant.id);
      const rules = cfg.autoReplyEnabled === false ? [] : (Array.isArray(cfg.autoReplyRules) ? cfg.autoReplyRules : []);
      dg.rulesActive = rules.filter(r => r.message && r.message.trim()).length;
      if (cfg.autoReplyEnabled === false) dg.skipped = 'auto-reply OFF untuk merchant ini';
      else if (rules.length === 0) dg.skipped = 'belum ada aturan';

      let orders;
      try {
        orders = bx.isBingx(merchant)
          ? (await bx.fetchQuick(merchant)).map(o => ({ ...o, _state: o.state }))
          : await fetchRecentOrders(merchant, 24, 3);
        dg.lastError = null;
      }
      catch (e) {
        dg.lastError = `fetch: ${e.response?.data?.msg || e.bingx?.msg || e.message}`;
        console.error(`[autoreply] ${merchant.name}: fetch gagal —`, dg.lastError); continue;
      }
      dg.ordersSeen = orders.length;
      dg.running = orders.filter(o => [0, 1, 2, 3, 9].includes(o._state)).length;

      const prev = states[merchant.id] || {};
      const next = {};
      orders.forEach(o => { next[o.advOrderNo] = o._state; });

      // v77: verification lives in MEXC's chat (OVER_VERIFY_* system messages).
      // Scanned even when auto-reply is off, because the notifier wants these too.
      let verifyEvents = [];
      if (!bx.isBingx(merchant)) {
        verifyEvents = await scanVerifyEvents(merchant, orders, verifySeen, dg);
      }

      // Guard 1: never send on the first pass for a merchant.
      if (!primed.has(merchant.id)) {
        primed.add(merchant.id); dg.primedAt = Date.now();
        states[merchant.id] = { ...prev, ...next };
        dg.skipped = dg.skipped || 'siklus pertama setelah restart: hanya mencatat status';
        continue;
      }

      // Chat-driven triggers first: a PASS is the message the buyer is waiting for.
      for (const ev of verifyEvents) {
        dg.verifyEvents.unshift({ at: Date.now(), advOrderNo: ev.order.advOrderNo, kind: ev.kind, key: ev.key });
        if (dg.verifyEvents.length > 12) dg.verifyEvents.length = 12;
        if (notifier && ev.kind !== 'other') {
          const type = ev.kind === 'file' ? 'verify' : ev.kind === 'pass' ? 'verified' : 'verifyFailed';
          notifier.dispatch({ type, o: ev.order, merchant, url: '/queue' }).catch(() => {});
        }
        if (sentThisCycle >= MAX_PER_CYCLE || rules.length === 0) continue;
        const matched = matchVerifyRules(rules, ev.order, ev.kind);
        if (matched.length === 0) continue;
        dg.lastMatch = { at: Date.now(), advOrderNo: ev.order.advOrderNo, rules: matched.map(r => r.id), isNew: false, prevState: `verif:${ev.kind}`, state: ev.order._state };
        sentThisCycle += await deliver(merchant, ev.order, matched, dg, MAX_PER_CYCLE - sentThisCycle);
      }

      if (rules.length === 0) { states[merchant.id] = { ...prev, ...next }; continue; }

      for (const o of orders) {
        if (sentThisCycle >= MAX_PER_CYCLE) break;
        const prevState = prev[o.advOrderNo];
        const isNew = prevState === undefined;
        if (!isNew && prevState !== o._state) noteTransition(dg, o, prevState, o._state);
        const matched = matchRules(rules, o, prevState, isNew);
        if (matched.length === 0) continue;
        dg.lastMatch = { at: Date.now(), advOrderNo: o.advOrderNo, rules: matched.map(r => r.id), isNew, prevState, state: o._state };
        sentThisCycle += await deliver(merchant, o, matched, dg, MAX_PER_CYCLE - sentThisCycle);
      }

      states[merchant.id] = { ...prev, ...next };
    }

    // Keep the state files from growing forever: only orders seen this cycle.
    writeJson(STATE_PATH, states);
    const cutoff = Date.now() - 3 * 24 * 3600000; // an order's verification is over long before this
    for (const [no, v] of Object.entries(verifySeen)) if (!v || !(v._t > cutoff)) delete verifySeen[no];
    writeJson(VERIFY_PATH, verifySeen);
  } catch (e) {
    console.error('[autoreply] cycle error:', e.message);
  } finally {
    running = false;
  }
}

function readSettingsSafe() { return readMerchantSettings(); }

function start() {
  if (process.env.AUTO_REPLY_WORKER === '0') { console.log('[autoreply] dimatikan via AUTO_REPLY_WORKER=0'); return; }
  console.log(`[autoreply] worker ON — tiap ${INTERVAL_MS / 1000}s (siklus pertama tidak mengirim apa pun)`);
  timer = setInterval(cycle, INTERVAL_MS);
  setTimeout(cycle, 6000);
}
function stop() { if (timer) clearInterval(timer); }

module.exports = { start, stop, status, matchRules, matchVerifyRules };

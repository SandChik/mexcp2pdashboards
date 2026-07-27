const fs = require('fs');
const path = require('path');
const { readConfig, getMerchant } = require('./store');
const { mexcGet, mexcPost } = require('./mexcApi');
const { fetchRecentOrders, normState } = require('./captureCore');
const wsManager = require('./wsManager');
const { claim, release } = require('./autoReplyLedger');
const { audit } = require('./audit');

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
const SETTINGS_PATH = path.join(__dirname, '../data/merchant-settings.json');
const INTERVAL_MS = Math.max(10000, Number(process.env.AUTO_REPLY_INTERVAL_MS) || 15000);
const GAP_MS = 900;           // spacing between two messages to the same buyer
const MAX_PER_CYCLE = 12;     // hard ceiling: a bug can never fan out unbounded

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function writeJson(p, o) { try { fs.writeFileSync(p, JSON.stringify(o)); } catch {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));

let running = false;
let timer = null;
const primed = new Set();   // merchantIds whose baseline states are recorded

/** Resolve conversation id for an order, then ensure a live socket. */
async function openChat(merchant, advOrderNo) {
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

/** Which rules fire for this order's transition. */
function matchRules(rules, order, prevState, isNew) {
  return (rules || []).filter(rule => {
    if (!rule.message || !rule.message.trim()) return false;
    if (rule.side !== 'ANY' && rule.side !== order.side) return false;
    if (rule.state === -1) return isNew;                    // "order baru masuk"
    if (rule.state !== order._state) return false;
    return isNew || prevState !== order._state;             // only on ENTERING the state
  });
}

async function cycle() {
  if (running) return;
  running = true;
  let sentThisCycle = 0;
  try {
    const merchants = (readConfig().merchants || []).map(m => getMerchant(m.id)).filter(Boolean);
    if (merchants.length === 0) return;
    const settings = readSettingsSafe();
    const states = readJson(STATE_PATH);

    for (const merchant of merchants) {
      const cfg = settings[merchant.id] || {};
      if (cfg.autoReplyEnabled === false) continue;
      const rules = Array.isArray(cfg.autoReplyRules) ? cfg.autoReplyRules : [];
      if (rules.length === 0) continue;

      let orders;
      try { orders = await fetchRecentOrders(merchant, 24, 3); }
      catch (e) { console.error(`[autoreply] ${merchant.name}: fetch gagal —`, e.response?.data?.msg || e.message); continue; }

      const prev = states[merchant.id] || {};
      const next = {};
      orders.forEach(o => { next[o.advOrderNo] = o._state; });

      // Guard 1: never send on the first pass for a merchant.
      if (!primed.has(merchant.id)) {
        primed.add(merchant.id);
        states[merchant.id] = { ...prev, ...next };
        continue;
      }

      for (const o of orders) {
        if (sentThisCycle >= MAX_PER_CYCLE) break;
        const prevState = prev[o.advOrderNo];
        const isNew = prevState === undefined;
        const matched = matchRules(rules, o, prevState, isNew);
        if (matched.length === 0) continue;

        // Guard 2: the ledger grants each (order, rule) exactly once, ever.
        const granted = claim(merchant.id, o.advOrderNo, matched.map(r => r.id));
        if (granted.length === 0) continue;

        let cid;
        try { cid = await openChat(merchant, o.advOrderNo); }
        catch (e) {
          release(merchant.id, o.advOrderNo, granted); // retry next cycle
          console.error(`[autoreply] ${merchant.name} ${o.advOrderNo}: chat gagal —`, e.message);
          continue;
        }

        for (const rule of matched.filter(r => granted.includes(r.id))) {
          // Guard 3: check the conversation itself right before sending.
          if (await alreadySaid(merchant, cid, rule.message)) continue;
          const r = wsManager.send(merchant.id, cid, rule.message);
          if (r?.success) {
            sentThisCycle++;
            console.log(`[autoreply] ${merchant.name} → ${o.userInfo?.nickName || o.advOrderNo} (${rule.id})`);
            audit({ action: 'auto_reply_sent', merchantId: merchant.id, merchantName: merchant.name, advOrderNo: o.advOrderNo, ruleId: rule.id });
          } else {
            release(merchant.id, o.advOrderNo, [rule.id]);
            console.error(`[autoreply] ${merchant.name} ${o.advOrderNo}: kirim gagal —`, r?.error);
          }
          await sleep(GAP_MS);
        }
      }

      states[merchant.id] = { ...prev, ...next };
    }

    // Keep the state file from growing forever: only orders seen this cycle.
    writeJson(STATE_PATH, states);
  } catch (e) {
    console.error('[autoreply] cycle error:', e.message);
  } finally {
    running = false;
  }
}

function readSettingsSafe() { return readJson(SETTINGS_PATH); }

function start() {
  if (process.env.AUTO_REPLY_WORKER === '0') { console.log('[autoreply] dimatikan via AUTO_REPLY_WORKER=0'); return; }
  console.log(`[autoreply] worker ON — tiap ${INTERVAL_MS / 1000}s (siklus pertama tidak mengirim apa pun)`);
  timer = setInterval(cycle, INTERVAL_MS);
  setTimeout(cycle, 6000);
}
function stop() { if (timer) clearInterval(timer); }

module.exports = { start, stop };

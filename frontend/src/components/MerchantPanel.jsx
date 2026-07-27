import { useState, useEffect, useCallback, useRef } from 'react';
import { ordersApi, adsApi, merchantApi, chatApi, registryApi, autoReplyApi } from '../api';
import {
  OrderStateBadge, SideBadge, AdStatusBadge, formatTime, formatAmount, formatCompact,
  ORDER_STATES, normalizeState,
} from './helpers';
import { playSound, soundForState } from '../sounds';
import { actionFor, runAction } from '../actions';
import { askConfirm } from './confirm';
import { addNotif } from '../notifications';
import OrderDetailModal from './OrderDetailModal';
import AdModal from './AdModal';
import {
  Power, MessageSquare, ToggleLeft, ToggleRight, RefreshCw, MoreVertical, Pencil, Clock, AlertTriangle, Pause, Play, UserX, Coins, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';

const ORDER_FILTERS = [
  { key: 'all',       label: 'Semua',  states: null },
  { key: 'active',    label: 'Aktif',  states: [0, 1, 2, 3] },
  { key: 'done',      label: 'Selesai',states: [4] },
  { key: 'cancelled', label: 'Batal',  states: [5, 6, 7, 8] },
];

function fmtRemaining(ms) {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export default function MerchantPanel({ merchant, dateRange, refreshKey, autoRefresh }) {
  const [orders, setOrders]           = useState([]);
  const [ads, setAds]                 = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [serviceOpen, setServiceOpen] = useState(true);
  const [lastSync, setLastSync]       = useState(null);
  const [syncError, setSyncError]     = useState(false);
  const syncErrorRef = useRef(false);
  const [now, setNow]                 = useState(Date.now());
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [openChatOrder, setOpenChatOrder] = useState(null);
  const [showAdModal, setShowAdModal] = useState(false);
  const [editAd, setEditAd]           = useState(null);
  const [tab, setTab]                 = useState('orders');
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderSide, setOrderSide]     = useState('ALL');
  const [adFilter, setAdFilter]       = useState('ALL');
  const [togglingAd, setTogglingAd]   = useState(null);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [pausedAds, setPausedAds]     = useState([]);
  const [busyTrading, setBusyTrading] = useState(false);
  const [rowBusy, setRowBusy]         = useState(null); // advOrderNo mid-action
  const [rowDone, setRowDone]         = useState(null); // advOrderNo that just succeeded (green flash)
  const [buyerLog, setBuyerLog]       = useState(false); // permanent buyer log + duplicate-name alert
  const buyerLogRef = useRef(false);
  useEffect(() => { buyerLogRef.current = buyerLog; }, [buyerLog]);
  const [logNameIndex, setLogNameIndex] = useState({}); // normalized realName -> [advOrderNo] from the permanent log
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const autoReplyEnabledRef = useRef(true);
  useEffect(() => { autoReplyEnabledRef.current = autoReplyEnabled; }, [autoReplyEnabled]);
  const autoRulesRef = useRef([]); // per-merchant auto-reply rules (from merchant settings)
  const [nameMap, setNameMap]         = useState({}); // advOrderNo -> { realName, memberId }

  const prevStates  = useRef({});
  const prevUnread  = useRef({});
  const initialized = useRef(false);
  const busyRef     = useRef(false);
  const rangeRef    = useRef(dateRange);
  const menuRef     = useRef(null);
  const nameMapRef  = useRef({});
  const capturedRef = useRef(new Set());
  const loggedRef   = useRef(new Set()); // advOrderNos already sent to the buyer log
  const enteredRef  = useRef(new Set()); // advOrderNo:state we've witnessed entering (for auto-reply retry)
  const AUTOSENT_KEY = 'mexc_autosent';
  const autoSentRef = useRef(new Set((() => { try { return JSON.parse(localStorage.getItem(AUTOSENT_KEY)) || []; } catch { return []; } })()));
  const persistAutoSent = () => { try { localStorage.setItem(AUTOSENT_KEY, JSON.stringify([...autoSentRef.current].slice(-500))); } catch { /* */ } };

  async function autoSend(o, rule) {
    const text = rule.message;
    if (!text || !text.trim()) return;
    const sk = `${o.advOrderNo}:${rule.id}`;
    autoSentRef.current.add(sk); persistAutoSent();
    try {
      const cr = await chatApi.getConversation(merchant.id, o.advOrderNo);
      const cid = cr.data?.data?.conversationId || cr.data?.conversationId || cr.data?.data?.id;
      if (!cid) throw new Error('no conversation id');
      await chatApi.connect(merchant.id, cid).catch(() => {});
      await chatApi.send(merchant.id, cid, text);
      addNotif('Auto-reply', `${merchant.name} — ${o.userInfo?.nickName || 'buyer'}: ${text.slice(0, 45)}${text.length > 45 ? '…' : ''}`);
    } catch (e) {
      // Hand the claim back so a later poll can retry — otherwise a transient
      // network error would silently swallow the message forever.
      autoSentRef.current.delete(sk); persistAutoSent();
      autoReplyApi.release(merchant.id, o.advOrderNo, [rule.id]).catch(() => {});
      addNotif('Auto-reply failed', `${merchant.name} — ${o.userInfo?.nickName || 'buyer'}: ${e?.response?.data?.error || e?.message || 'send error'}`);
    }
  }

  // Send multiple matching rules one-by-one (in order) so they don't collide.
  //
  // The local ledger (localStorage) is only a fast path — it is per browser, so
  // a phone and a laptop each thought they were first and both sent. The server
  // grants every (order, rule) exactly once across all devices; we send only
  // what it grants.
  async function autoSendSequential(o, rules) {
    let granted;
    try {
      const r = await autoReplyApi.claim(merchant.id, o.advOrderNo, rules.map(x => x.id));
      const ok = new Set(r.data?.granted || []);
      granted = rules.filter(x => ok.has(x.id));
      // Remember what the server refused so we stop re-asking every poll.
      const refused = rules.filter(x => !ok.has(x.id));
      if (refused.length) {
        refused.forEach(x => autoSentRef.current.add(`${o.advOrderNo}:${x.id}`));
        persistAutoSent();
      }
    } catch {
      return; // Can't verify → stay silent. A missed greeting beats a double one.
    }
    for (const rule of granted) {
      await autoSend(o, rule);
      await new Promise(res => setTimeout(res, 900));
    }
  }

  useEffect(() => { rangeRef.current = dateRange; }, [dateRange]);

  // Per-merchant settings: buyer log toggle + auto-reply (enabled flag AND rules
  // now live per merchant on the backend — no longer global localStorage).
  useEffect(() => { merchantApi.getSettings(merchant.id).then(r => {
    setBuyerLog(!!r.data?.buyerLog);
    setAutoReplyEnabled(r.data?.autoReplyEnabled !== false); // default ON
    autoRulesRef.current = Array.isArray(r.data?.autoReplyRules) ? r.data.autoReplyRules : [];
  }).catch(() => {}); }, [merchant.id]);

  // Load the permanent buyer-name index for duplicate alerts
  const loadNameIndex = useCallback(async () => {
    try { const r = await registryApi.list(merchant.id); setLogNameIndex(r.data?.nameIndex || {}); }
    catch { /* keep last */ }
  }, [merchant.id]);
  useEffect(() => { if (buyerLog) loadNameIndex(); }, [buyerLog, loadNameIndex]);

  // Resolve real names (cached server-side) only for orders we haven't seen yet
  useEffect(() => {
    if (!buyerLog || orders.length === 0) return;
    const missing = orders.map(o => o.advOrderNo).filter(no => no && !(no in nameMapRef.current));
    if (missing.length === 0) return;
    let cancelled = false;
    ordersApi.memberIds(merchant.id, missing).then(r => {
      if (cancelled) return;
      const map = r.data?.map || {};
      setNameMap(prev => { const next = { ...prev, ...map }; nameMapRef.current = next; return next; });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [orders, buyerLog, merchant.id]);

  // Load remembered pause state for this merchant
  useEffect(() => { merchantApi.getPauseState(merchant.id).then(r => setPausedAds(r.data?.ads || [])).catch(() => {}); }, [merchant.id]);

  // 1s tick to drive countdown timers
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const doFetch = useCallback(async (quiet = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (!quiet) setRefreshing(true);
    try {
      const r = await ordersApi.market(merchant.id, {
        startTime: rangeRef.current.startTime,
        // Live presets (today/event/3d/7d) must always query up to NOW, or new
        // orders created after the dashboard opened fall outside the window and
        // never get detected. Only a fixed custom range uses its chosen end.
        endTime: rangeRef.current.kind === 'custom' ? rangeRef.current.endTime : Date.now(),
      });
      const raw = r.data;
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
      const normalized = list.map(o => ({ ...o, _state: normalizeState(o.state) }));

      if (initialized.current) {
        let newActive = 0, prevActive = 0;
        normalized.forEach(o => {
          const ps = prevStates.current[o.advOrderNo];
          const pu = prevUnread.current[o.advOrderNo];
          if (ps !== undefined && ps !== o._state) {
            const ev = soundForState(o._state); // paid / done / cancelled — silent for intermediate states
            if (ev) playSound(ev);
            const sc = `${o.userInfo?.nickName || 'Order'}: ${ORDER_STATES[ps]?.label || ps} → ${ORDER_STATES[o._state]?.label || o._state}`;
            toast(sc, { duration: 5000 });
            addNotif('Order', `${merchant.name} — ${sc}`);
          }
          if (pu !== undefined && (o.unreadCount || 0) > pu) {
            playSound('message');
            toast(`${o.userInfo?.nickName || 'Buyer'}: new message`, { duration: 3000 });
            addNotif('Message', `${merchant.name} — ${o.userInfo?.nickName || 'Buyer'}: new message`);
          }
          if ([0, 1, 2, 3].includes(o._state)) newActive++;
          const no = o.advOrderNo;
          // Witness entries (kept across polls so we can retry until the send succeeds).
          if (ps === undefined) {
            enteredRef.current.add(`${no}:new`);              // first time we ever see this order
            enteredRef.current.add(`${no}:${o._state}`);
            addNotif('New order', `${merchant.name} — ${o.userInfo?.nickName || 'order'}: ${ORDER_STATES[o._state]?.label || o._state}`);
          } else if (ps !== o._state) {
            enteredRef.current.add(`${no}:${o._state}`);
          }
          if (autoReplyEnabledRef.current) {
            const matched = (autoRulesRef.current || []).filter(rule => {
              if (rule.side !== 'ANY' && rule.side !== o.side) return false;
              if (autoSentRef.current.has(`${no}:${rule.id}`)) return false;
              if (rule.state === -1) return enteredRef.current.has(`${no}:new`);          // greet on arrival, any status
              return rule.state === o._state && enteredRef.current.has(`${no}:${o._state}`);
            });
            if (matched.length) autoSendSequential(o, matched);
          }
        });
        Object.values(prevStates.current).forEach(s => { if ([0, 1, 2, 3].includes(s)) prevActive++; });
        if (newActive > prevActive) { playSound('newOrder'); toast.success(`New order — ${merchant.name}`, { duration: 4000 }); }
      }

      const ns = {}, nu = {};
      normalized.forEach(o => { ns[o.advOrderNo] = o._state; nu[o.advOrderNo] = o.unreadCount || 0; });
      prevStates.current = ns; prevUnread.current = nu; initialized.current = true;
      setOrders(normalized); setLastSync(Date.now()); setSyncError(false); syncErrorRef.current = false;
    } catch (e) {
      // Sound only on the transition into an error state, not every 5s poll.
      if (!syncErrorRef.current) playSound('error');
      syncErrorRef.current = true;
      setSyncError(true);
      if (!quiet) toast.error(`Gagal memuat order — ${merchant.name}. Cek koneksi atau API key.`);
    } finally {
      setLoading(false); setRefreshing(false); busyRef.current = false;
    }
  }, [merchant.id, merchant.name]);

  const fetchAds = useCallback(async () => {
    try {
      const r = await adsApi.list(merchant.id, {});
      const raw = r.data;
      setAds(Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []));
    } catch { /* keep last */ }
  }, [merchant.id]);

  // Snapshot buyer trade stats for in-progress SELL orders (MEXC drops them once DONE)
  useEffect(() => {
    const toCapture = orders
      .filter(o => o.side === 'SELL' && [0, 1, 2, 3].includes(o._state) && o.advOrderNo && !capturedRef.current.has(o.advOrderNo))
      .map(o => o.advOrderNo);
    if (toCapture.length === 0) return;
    toCapture.forEach(no => capturedRef.current.add(no));
    ordersApi.captureStats(merchant.id, toCapture).catch(() => {});
  }, [orders, merchant.id]); // eslint-disable-line

  // Buyer log: record every COMPLETED SELL order (buyer = counterpart who bought
  // USDT). Server dedups per advOrderNo, so re-sends across restarts are cheap.
  useEffect(() => {
    if (!buyerLog) return;
    const done = orders.filter(o =>
      o.side === 'SELL' && o._state === 4 && o.advOrderNo && !loggedRef.current.has(o.advOrderNo));
    if (done.length === 0) return;
    done.forEach(o => loggedRef.current.add(o.advOrderNo));
    registryApi.capture(merchant.id, done.map(o => ({
      advOrderNo: o.advOrderNo,
      amount: parseFloat(o.amount) || 0,
      usdt: parseFloat(o.tradableQuantity) || 0,
      fiatUnit: o.fiatUnit || '',
      doneAt: o.updateTime || o.createTime || Date.now(),
    }))).then(r => { if (r.data?.added) loadNameIndex(); })
      .catch(() => { done.forEach(o => loggedRef.current.delete(o.advOrderNo)); });
  }, [orders, buyerLog, merchant.id, loadNameIndex]); // eslint-disable-line

  useEffect(() => {
    initialized.current = false; prevStates.current = {}; prevUnread.current = {};
    setOrders([]); setLoading(true);
    doFetch(false); fetchAds();
  }, [merchant.id, dateRange]); // eslint-disable-line

  useEffect(() => { if (refreshKey > 0) { doFetch(false); fetchAds(); } }, [refreshKey]); // eslint-disable-line

  useEffect(() => {
    if (!autoRefresh) return;
    const o = setInterval(() => doFetch(true), 5000);
    const a = setInterval(() => fetchAds(), 30000);
    return () => { clearInterval(o); clearInterval(a); };
  }, [doFetch, fetchAds, autoRefresh]);

  useEffect(() => {
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Derived
  const sideOrders = orderSide === 'ALL' ? orders : orders.filter(o => o.side === orderSide);
  const filteredOrders = sideOrders.filter(o => {
    const f = ORDER_FILTERS.find(f => f.key === orderFilter);
    return !f?.states || f.states.includes(o._state);
  }).slice().sort((a, b) => {
    const aActive = [0, 1, 2, 3].includes(a._state), bActive = [0, 1, 2, 3].includes(b._state);
    if (aActive && bActive) return (a.payTimeLimit || Infinity) - (b.payTimeLimit || Infinity); // soonest deadline first
    if (aActive !== bActive) return aActive ? -1 : 1; // active first
    return (b.createTime || 0) - (a.createTime || 0); // newest first
  });
  const activeOrders = orders.filter(o => [0, 1, 2, 3].includes(o._state));
  const unread = orders.reduce((a, o) => a + (o.unreadCount || 0), 0);
  const liveAds = ads.filter(a => a.advStatus === 'OPEN' || a.advStatus === 1);
  const filteredAds = adFilter === 'ALL' ? ads : ads.filter(a => a.side === adFilter);

  const doneOrders = orders.filter(o => o._state === 4);
  const volBuy     = doneOrders.filter(o => o.side === 'BUY').reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
  const volSell    = doneOrders.filter(o => o.side === 'SELL').reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
  const volSellUsdt = doneOrders.filter(o => o.side === 'SELL').reduce((s, o) => s + (parseFloat(o.tradableQuantity) || 0), 0);
  const fiatUnit = orders[0]?.fiatUnit || 'IDR';
  const FAILED_STATES = new Set([5, 6, 7, 8]); // CANCEL, INVALID, REFUSE, TIMEOUT — never completed, shouldn't count toward duplicate-buyer detection
  const normName = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  // In-view counts (catches two ACTIVE orders with the same KYC name before either completes)
  const nameCounts = {};
  if (buyerLog) orders.forEach(o => {
    if (FAILED_STATES.has(o._state)) return;
    const rn = nameMap[o.advOrderNo]?.realName;
    if (rn) { const k = normName(rn); nameCounts[k] = (nameCounts[k] || 0) + 1; }
  });
  // Alert if this order's KYC name appears in the PERMANENT log under another
  // order (history, any date) OR more than once in the current view.
  const dupInfo = (advOrderNo) => {
    const rn = nameMap[advOrderNo]?.realName;
    if (!rn) return null;
    const k = normName(rn);
    const inLog = (logNameIndex[k] || []).filter(no => no !== advOrderNo).length;
    const inView = nameCounts[k] || 0;
    const total = inLog + inView; // this order counts once via inView (if not failed)
    return total >= 2 || inLog >= 1 ? { name: rn, count: Math.max(total, inLog + 1) } : null;
  };

  const filterCounts = ORDER_FILTERS.reduce((acc, f) => {
    acc[f.key] = f.states ? sideOrders.filter(o => f.states.includes(o._state)).length : sideOrders.length;
    return acc;
  }, {});

  async function toggleService() {
    const open = !serviceOpen;
    try { await merchantApi.serviceSwitch(merchant.id, open); setServiceOpen(open); toast.success(open ? 'Merchant open' : 'Merchant closed'); }
    catch { toast.error('Switch failed'); }
    setMenuOpen(false);
  }

  // Announce a newly-detected duplicate KYC name once (sound + toast), so you
  // catch it even if you're looking at another panel.
  const dupAnnounced = useRef(new Set());
  useEffect(() => {
    if (!buyerLog) return;
    orders.forEach(o => {
      const d = dupInfo(o.advOrderNo);
      if (d && !dupAnnounced.current.has(o.advOrderNo)) {
        dupAnnounced.current.add(o.advOrderNo);
        playSound('duplicate');
        toast(`Nama sama: ${d.name} (${d.count}\u00d7) — ${merchant.name}`, { duration: 7000, icon: '\u26a0\ufe0f' });
        addNotif('Nama duplikat', `${merchant.name} — ${d.name} tercatat ${d.count}\u00d7`);
      }
    });
  }, [orders, nameMap, logNameIndex, buyerLog]); // eslint-disable-line

  // Inline action straight from the list — same confirmation dialog as the
  // modal, minus opening and closing it.
  async function rowAction(order, e) {
    e?.stopPropagation();
    if (rowBusy) return;
    setRowBusy(order.advOrderNo);
    try {
      const ok = await runAction(merchant.id, order);
      if (ok) {
        setRowDone(order.advOrderNo);
        setTimeout(() => setRowDone(null), 1200);
        doFetch(false);
      }
    } finally { setRowBusy(null); }
  }

  async function toggleBuyerLog() {
    const v = !buyerLog;
    setBuyerLog(v); setMenuOpen(false);
    try { await merchantApi.setSettings(merchant.id, { buyerLog: v }); toast.success(v ? 'Catat buyer & alert nama: ON' : 'Catat buyer & alert nama: OFF'); }
    catch { setBuyerLog(!v); toast.error('Failed to save setting'); }
  }

  async function toggleAutoReplyForMerchant() {
    const v = !autoReplyEnabled;
    setAutoReplyEnabled(v); setMenuOpen(false);
    try { await merchantApi.setSettings(merchant.id, { autoReplyEnabled: v }); toast.success(`Auto-reply ${v ? 'ON' : 'OFF'} for ${merchant.name}`); }
    catch { setAutoReplyEnabled(!v); toast.error('Failed to save setting'); }
  }

  function buildAdParams(ad) {
    return {
      advNo: ad.advNo || ad.davNo, side: ad.side, fiatUnit: ad.fiatUnit, coinId: ad.coinId, price: ad.price,
      availableQuantity: ad.availableQuantity,
      minSingleTransAmount: ad.minSingleTransAmount, maxSingleTransAmount: ad.maxSingleTransAmount,
      payMethod: ad.payMethod, paymentInfo: ad.paymentInfo,
      payTimeLimit: ad.payTimeLimit || 15, kycLevel: ad.kycLevel,
      requireMobile: ad.requireMobile ?? false,
      autoReplyMsg: ad.autoReplyMsg || '', tradeTerms: ad.tradeTerms || '',
      priceType: ad.priceType ?? 0, allowSys: ad.allowSys ?? true, countryCode: ad.countryCode || '',
      userAllTradeCountMin: ad.userAllTradeCountMin ?? 0, userAllTradeCountMax: ad.userAllTradeCountMax ?? 0,
      buyerRegDaysLimit: ad.buyerRegDaysLimit ?? 0, maxPayLimit: ad.maxPayLimit ?? 0,
      exchangeCount: ad.exchangeCount ?? 0, blockTrade: ad.blockTrade ?? false,
    };
  }
  async function setAdStatus(ad, status) {
    const r = await adsApi.toggleStatus(merchant.id, buildAdParams(ad), status);
    return r.data || {};
  }
  const isCooldown = (d) => d.cooldown || d.code === 30014 || d.code === 30020;

  async function toggleAdStatus(ad, e) {
    e.stopPropagation();
    const isOpen = ad.advStatus === 'OPEN' || ad.advStatus === 1;
    const adNo = ad.advNo || ad.davNo;
    setTogglingAd(adNo);
    try {
      const d = await setAdStatus(ad, isOpen ? 'CLOSE' : 'OPEN');
      if (d.code === 0) { toast.success(isOpen ? 'Ad paused' : 'Ad live'); fetchAds(); }
      else if (isCooldown(d)) toast.error('MEXC rate limit: wait ~60s before changing this ad again', { duration: 6000 });
      else toast.error(`Can't activate: ${d.msg || 'unknown error'}${d.code ? ` (code ${d.code})` : ''}`, { duration: 8000 });
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setTogglingAd(null); }
  }

  async function freshAds() {
    try { const r = await adsApi.list(merchant.id, {}); const raw = r.data; return Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : ads); }
    catch { return ads; }
  }

  async function pauseTrading() {
    setMenuOpen(false);
    if (busyTrading) return;
    setBusyTrading(true);
    const tid = toast.loading(`Pausing ${merchant.name}...`);
    try {
      // Use what's on screen (includes an ad you just enabled) instead of
      // re-fetching, because MEXC's ad list lags right after a toggle.
      const current = ads.length ? ads : await freshAds();
      const openAds = current.filter(a => a.advStatus === 'OPEN' || a.advStatus === 1);
      if (openAds.length === 0) { toast.error(`${merchant.name}: no live ads to pause`, { id: tid }); return; }
      const okToPause = await askConfirm({ title: `Pause trading — ${merchant.name}`, message: `This closes all ${openAds.length} live ad(s) and remembers them. Resume turns them back on.`, confirmText: 'Pause all ads', danger: true });
      if (!okToPause) { toast.dismiss(tid); return; }
      const closed = [], failed = [];
      for (const ad of openAds) {
        try { const d = await setAdStatus(ad, 'CLOSE'); if (d.code === 0) closed.push(ad.advNo || ad.davNo); else failed.push({ price: ad.price, msg: isCooldown(d) ? 'wait ~60s (edited too recently)' : (d.msg || 'error') }); }
        catch { failed.push({ price: ad.price, msg: 'request failed' }); }
      }
      try { await merchantApi.setPauseState(merchant.id, true, closed); } catch { /* */ }
      setPausedAds(closed); fetchAds();
      if (failed.length === 0) { toast.success(`Paused ${merchant.name} — closed ${closed.length} ad(s)`, { id: tid }); addNotif('Paused', `${merchant.name} — ${closed.length} ad(s) closed`); }
      else toast.error(`Closed ${closed.length}, ${failed.length} failed: ${failed.map(f => `@${f.price} (${f.msg})`).join(', ')}`, { id: tid, duration: 10000 });
    } finally { setBusyTrading(false); }
  }

  async function resumeTrading() {
    setMenuOpen(false);
    if (busyTrading) return;
    setBusyTrading(true);
    const tid = toast.loading(`Resuming ${merchant.name}...`);
    try {
      let snapshot = pausedAds, pausedAt = 0;
      try { const r = await merchantApi.getPauseState(merchant.id); snapshot = r.data?.ads || pausedAds; pausedAt = r.data?.pausedAt || 0; } catch { /* */ }
      const current = await freshAds();
      const targets = current.filter(a => snapshot.includes(a.advNo || a.davNo));
      if (targets.length === 0) {
        await merchantApi.setPauseState(merchant.id, false, []).catch(() => {});
        setPausedAds([]); toast.error(`${merchant.name}: no paused ads found to resume`, { id: tid }); return;
      }
      // MEXC blocks editing an ad <60s after the last change — wait it out automatically.
      const until = pausedAt ? pausedAt + 60000 : 0;
      while (until && Date.now() < until) {
        const sec = Math.ceil((until - Date.now()) / 1000);
        toast.loading(`Cooldown — opening in ${sec}s...`, { id: tid });
        await new Promise(res => setTimeout(res, 1000));
      }
      toast.loading(`Resuming ${merchant.name}...`, { id: tid });
      const failedNos = [], failed = []; let ok = 0;
      for (const ad of targets) {
        const no = ad.advNo || ad.davNo;
        try {
          const d = await setAdStatus(ad, 'OPEN');
          if (d.code === 0) ok++;
          else { failedNos.push(no); failed.push({ price: ad.price, msg: isCooldown(d) ? 'still cooling down' : (d.msg || 'error') }); }
        } catch { failedNos.push(no); failed.push({ price: ad.price, msg: 'request failed' }); }
      }
      // Keep ONLY the failed ads in the snapshot so they stay tracked & resumable.
      await merchantApi.setPauseState(merchant.id, failedNos.length > 0, failedNos).catch(() => {});
      setPausedAds(failedNos); fetchAds();
      if (failed.length === 0) { toast.success(`Resumed ${merchant.name} — ${ok} ad(s) live`, { id: tid }); addNotif('Resumed', `${merchant.name} — ${ok} ad(s) back live`); }
      else toast.error(`Resumed ${ok}. ${failed.length} still paused (tap Resume again): ${failed.map(f => `@${f.price} (${f.msg})`).join(', ')}`, { id: tid, duration: 12000 });
    } finally { setBusyTrading(false); }
  }

  const syncLabel = syncError ? 'gagal sync' : lastSync ? `sync ${new Date(lastSync).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '';

  return (
    <div className="card flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-3 sm:px-3.5 pt-3 pb-3 border-b border-surface-700">
        <div className="flex items-center justify-between h-6">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${serviceOpen ? 'bg-buy shadow-glow-buy animate-pulse' : 'bg-sell'}`} />
            <span className="font-semibold text-surface-50 text-sm truncate">{merchant.name}</span>
            {refreshing && <RefreshCw size={11} className="text-brand-400 animate-spin flex-shrink-0" />}
            {unread > 0 && <span className="bg-sell/15 text-sell text-xs rounded px-1.5 py-0.5 font-medium flex-shrink-0">{unread} belum dibaca</span>}
            {pausedAds.length > 0 && <span className="bg-warning/15 text-warning text-xs rounded px-1.5 py-0.5 font-medium flex-shrink-0">{pausedAds.length} dijeda</span>}
          </div>
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button onClick={() => setMenuOpen(m => !m)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-surface-300 hover:text-surface-50 hover:bg-surface-700 transition-colors">
              <MoreVertical size={15} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-52 bg-surface-800 border border-surface-700 rounded-lg p-1 shadow-xl shadow-black/40">
                <button onClick={toggleBuyerLog}
                  className={`w-full flex items-center justify-between gap-2 text-xs rounded px-2 py-1.5 transition-colors ${buyerLog ? 'text-brand-400 hover:bg-brand-500/10' : 'text-surface-200 hover:bg-surface-700'}`}>
                  <span className="flex items-center gap-2"><UserX size={13} /> Catat buyer & alert nama</span>
                  <span className={`text-[10px] font-semibold ${buyerLog ? 'text-brand-400' : 'text-surface-300'}`}>{buyerLog ? 'ON' : 'OFF'}</span>
                </button>
                <button onClick={toggleAutoReplyForMerchant}
                  className={`w-full flex items-center justify-between gap-2 text-xs rounded px-2 py-1.5 transition-colors ${autoReplyEnabled ? 'text-brand-400 hover:bg-brand-500/10' : 'text-surface-200 hover:bg-surface-700'}`}>
                  <span className="flex items-center gap-2"><MessageSquare size={13} /> Auto-reply</span>
                  <span className={`text-[10px] font-semibold ${autoReplyEnabled ? 'text-brand-400' : 'text-surface-300'}`}>{autoReplyEnabled ? 'ON' : 'OFF'}</span>
                </button>
                <div className="h-px bg-surface-700 my-1" />
                <button onClick={pauseTrading} disabled={busyTrading}
                  className="w-full flex items-center gap-2 text-xs rounded px-2 py-1.5 transition-colors disabled:opacity-40 text-warning hover:bg-warning/10">
                  {busyTrading ? <RefreshCw size={13} className="animate-spin" /> : <Pause size={13} />} Pause trading
                </button>
                {pausedAds.length > 0 && (
                  <button onClick={resumeTrading} disabled={busyTrading}
                    className="w-full flex items-center gap-2 text-xs rounded px-2 py-1.5 transition-colors disabled:opacity-40 text-buy hover:bg-buy/10">
                    <Play size={13} /> Resume {pausedAds.length} ad(s)
                  </button>
                )}
                <div className="h-px bg-surface-700 my-1" />
                <button onClick={toggleService}
                  className={`w-full flex items-center gap-2 text-xs rounded px-2 py-1.5 transition-colors ${serviceOpen ? 'text-sell hover:bg-sell/10' : 'text-buy hover:bg-buy/10'}`}>
                  <Power size={13} /> {serviceOpen ? 'Close merchant (freeze API)' : 'Open merchant'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3 text-xs text-surface-300">
            <span><b className={`font-semibold ${activeOrders.length ? 'text-brand-300' : 'text-surface-50'}`}>{activeOrders.length}</b> aktif</span>
            <span><b className="font-semibold text-surface-50">{loading ? '·' : orders.length}</b> order</span>
            <span><b className="font-semibold text-surface-50">{liveAds.length}</b> iklan live</span>
          </div>
          <span className={`text-[10px] font-mono ${syncError ? 'text-sell' : 'text-surface-300/60'}`}>{syncLabel}</span>
        </div>

        {/* Volume — full numbers, fixed-height cells so panels stay aligned */}
        <div className="grid grid-cols-3 gap-2 mt-2.5">
          {[
            { label: `Buy (${fiatUnit})`, value: formatAmount(volBuy, 0), color: 'text-buy', bar: 'bg-buy' },
            { label: `Sell (${fiatUnit})`, value: formatAmount(volSell, 0), color: 'text-sell', bar: 'bg-sell' },
            { label: 'Sell (USDT)', value: formatAmount(volSellUsdt, 2), color: 'text-surface-50', bar: 'bg-brand-400' },
          ].map(s => (
            <div key={s.label} className="relative bg-surface-900 border border-surface-700 rounded-lg px-2 py-1.5 h-[54px] flex flex-col justify-center overflow-hidden">
              <span className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full ${s.bar}`} />
              <p className="text-[10px] uppercase tracking-wide text-surface-300 truncate pl-1.5">{s.label}</p>
              <p className={`text-sm font-mono font-semibold tnum whitespace-nowrap overflow-hidden pl-1.5 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs + side filter */}
      <div className="flex items-center gap-1 px-3 sm:px-3.5 py-2 border-b border-surface-700 overflow-x-auto no-scrollbar">
        <div className="seg flex-shrink-0">
          {[['orders', 'Order'], ['ads', 'Iklan']].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className={`seg-btn ${tab === t ? 'seg-btn-active' : ''}`}>
              {label}{t === 'orders' && activeOrders.length > 0 ? ` ${activeOrders.length}` : ''}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[8px]" />
        <div className="seg flex-shrink-0">
          {['ALL', 'BUY', 'SELL'].map(f => {
            const active = (tab === 'orders' ? orderSide : adFilter) === f;
            const tone = active ? (f === 'BUY' ? 'bg-buy/15 text-buy' : f === 'SELL' ? 'bg-sell/15 text-sell' : 'seg-btn-active') : '';
            return <button key={f} onClick={() => (tab === 'orders' ? setOrderSide(f) : setAdFilter(f))} className={`seg-btn ${tone}`}>{f}</button>;
          })}
        </div>
      </div>

      {tab === 'orders' && (
        <div className="flex items-center gap-1 px-3 sm:px-3.5 py-2 border-b border-surface-700 overflow-x-auto no-scrollbar">
          {ORDER_FILTERS.map(f => (
            <button key={f.key} onClick={() => setOrderFilter(f.key)}
              className={`tap-sm flex-shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors ${orderFilter === f.key ? 'bg-surface-700 text-surface-50 ring-1 ring-surface-600' : 'text-surface-300 hover:text-surface-50'}`}>
              {f.label}{filterCounts[f.key] > 0 ? <span className="ml-1 text-surface-300">{filterCounts[f.key]}</span> : ''}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 space-y-2.5">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[68px] w-full" />)}
          </div>
        ) : tab === 'orders' ? (
          filteredOrders.length === 0 ? (
            <div className="text-center py-12 px-6">
              <p className="text-sm text-surface-200">{orders.length === 0 ? 'Belum ada order pada rentang ini.' : 'Tidak ada order dengan filter ini.'}</p>
              <p className="text-xs text-surface-300 mt-1">{orders.length === 0 ? 'Coba ubah rentang tanggal di kanan atas.' : 'Pilih filter lain untuk melihat order yang ada.'}</p>
            </div>
          ) : filteredOrders.map(order => {
            const amtColor = order.side === 'BUY' ? 'text-buy' : 'text-sell';
            const isActive = [0, 1, 2, 3].includes(order._state);
            const remaining = isActive && order.payTimeLimit ? order.payTimeLimit - now : 0;
            const countdown = fmtRemaining(remaining);
            const urgent = countdown && remaining < 5 * 60 * 1000;
            const dup = buyerLog ? dupInfo(order.advOrderNo) : null;
            return (
              <div key={order.advOrderNo}
                className={`border-b border-surface-700/60 hover:bg-surface-900/60 transition-colors border-l-2 ${
                  dup ? 'border-l-sell bg-sell/[0.05]' : (ORDER_STATES[order._state]?.accent || 'border-l-transparent')}`}>
                <button onClick={() => setSelectedOrder(order.advOrderNo)} className="w-full px-3 sm:px-3.5 py-3 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <SideBadge side={order.side} />
                        <OrderStateBadge state={order._state} />
                        {dup && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full pl-1.5 pr-2 py-0.5 bg-sell/15 text-sell ring-1 ring-sell/30"
                            title={`Nama KYC "${dup.name}" tercatat di ${dup.count} order (termasuk riwayat di Catatan Buyer) — kemungkinan 1 KTP banyak akun`}>
                            <AlertTriangle size={11} /> Nama sama ×{dup.count}
                          </span>
                        )}
                        {countdown && (
                          <span className={`flex items-center gap-0.5 text-[11px] font-mono tnum rounded-md px-1.5 py-0.5 ${urgent ? 'bg-sell/15 text-sell animate-pulse-ring' : 'bg-warning/10 text-warning'}`}>
                            {urgent ? <AlertTriangle size={10} /> : <Clock size={10} />}{countdown}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-200 truncate">{order.userInfo?.nickName || 'Unknown'}</p>
                      <p className="text-[11px] text-surface-300/70 font-mono mt-0.5">{formatTime(order.createTime)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`block text-lg font-mono font-semibold tnum leading-none ${amtColor}`}>{formatAmount(order.amount, 0)}</span>
                      <span className="text-[11px] text-surface-300 font-mono">{order.fiatUnit}</span>
                      {order.tradableQuantity && <span className="block text-xs text-surface-200 font-mono mt-0.5">{formatAmount(order.tradableQuantity, 2)} USDT</span>}
                    </div>
                  </div>
                </button>
                {(() => {
                  const kind = actionFor(order);
                  if (!kind) return null;
                  const isBusy = rowBusy === order.advOrderNo;
                  const justDone = rowDone === order.advOrderNo;
                  return (
                    <div className="px-3 sm:px-3.5 pb-2.5 -mt-1">
                      <button onClick={e => rowAction(order, e)} disabled={!!rowBusy || justDone}
                        className={`w-full flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg h-9 border transition-all disabled:opacity-50 ${
                          justDone ? 'bg-buy/20 text-buy border-buy/40'
                          : kind === 'release'
                            ? 'bg-buy/10 text-buy border-buy/25 hover:bg-buy/20 hover:shadow-glow-buy'
                            : 'bg-brand-500/10 text-brand-300 border-brand-500/25 hover:bg-brand-500/20 hover:shadow-glow-sm'}`}>
                        {justDone ? <><CheckCircle2 size={13} /> Berhasil</>
                          : isBusy ? <RefreshCw size={13} className="animate-spin" />
                          : kind === 'release' ? <><Coins size={13} /> Release coin</>
                          : <><CheckCircle2 size={13} /> Konfirmasi bayar</>}
                      </button>
                    </div>
                  );
                })()}
                {order.unreadCount > 0 && (
                  <button onClick={() => setOpenChatOrder(order.advOrderNo)}
                    className="mx-3 sm:mx-3.5 mb-2.5 flex items-center gap-1.5 text-xs text-sell hover:bg-sell/10 bg-sell/5 border border-sell/20 px-2.5 py-1.5 rounded-lg transition-colors">
                    <MessageSquare size={12} /> {order.unreadCount} pesan belum dibaca — buka chat
                  </button>
                )}
              </div>
            );
          })
        ) : (
          filteredAds.length === 0 ? (
            <div className="text-center py-12 px-6">
              <p className="text-sm text-surface-200">Belum ada iklan.</p>
              <p className="text-xs text-surface-300 mt-1">Buat iklan lewat aplikasi MEXC, lalu refresh panel ini.</p>
            </div>
          ) : (
            <div className="p-2.5 sm:p-3 space-y-2.5">
              {filteredAds.map(ad => {
                const adNo = ad.advNo || ad.davNo;
                const isOpen = ad.advStatus === 'OPEN' || ad.advStatus === 1;
                return (
                  <div key={adNo} className={`bg-surface-900 border rounded-xl p-3 transition-all card-hover ${isOpen ? 'border-surface-700' : 'border-surface-700/50 opacity-60'}`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-1.5"><SideBadge side={ad.side} /><AdStatusBadge status={ad.advStatus} /></div>
                      <button onClick={e => toggleAdStatus(ad, e)} disabled={togglingAd === adNo} title={isOpen ? 'Pause ad' : 'Activate ad'}
                        className={`transition-colors disabled:opacity-40 ${isOpen ? 'text-buy hover:text-sell' : 'text-surface-300 hover:text-buy'}`}>
                        {togglingAd === adNo ? <RefreshCw size={18} className="animate-spin" /> : isOpen ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                    </div>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-lg font-mono font-semibold text-surface-50">{formatAmount(ad.price, 0)}</span>
                      <span className="text-xs text-surface-300 font-mono">{ad.fiatUnit} / USDT</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div className="bg-surface-800 rounded-md px-2 py-1.5">
                        <p className="text-surface-300 text-[10px] uppercase tracking-wide">Available</p>
                        <p className="text-surface-50 font-mono">{formatAmount(ad.availableQuantity, 2)} USDT</p>
                      </div>
                      <div className="bg-surface-800 rounded-md px-2 py-1.5">
                        <p className="text-surface-300 text-[10px] uppercase tracking-wide">Limit ({ad.fiatUnit})</p>
                        <p className="text-surface-50 font-mono">{formatCompact(ad.minSingleTransAmount)}–{formatCompact(ad.maxSingleTransAmount)}</p>
                      </div>
                    </div>
                    <button onClick={() => { setEditAd(ad); setShowAdModal(true); }}
                      className="w-full flex items-center justify-center gap-1.5 text-xs text-surface-200 hover:text-surface-50 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-md py-1.5 transition-colors">
                      <Pencil size={12} /> Ubah iklan
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {(selectedOrder || openChatOrder) && (
        <OrderDetailModal merchantId={merchant.id} advOrderNo={selectedOrder || openChatOrder}
          initialTab={openChatOrder && !selectedOrder ? 'chat' : 'detail'}
          onClose={() => { setSelectedOrder(null); setOpenChatOrder(null); doFetch(false); fetchAds(); }}
          onActionDone={() => doFetch(false)} />
      )}
      {showAdModal && editAd && (
        <AdModal merchantId={merchant.id} existingAd={editAd}
          onClose={() => { setShowAdModal(false); setEditAd(null); }} onSaved={fetchAds} />
      )}
    </div>
  );
}

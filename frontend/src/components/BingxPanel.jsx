import { useState, useEffect, useCallback, useRef } from 'react';
import { ordersApi, adsApi, merchantApi } from '../api';
import {
  OrderStateBadge, SideBadge, AdStatusBadge, PlatformBadge, formatTime, formatAmount,
  ORDER_STATES, normalizeState,
} from './helpers';
import { playSound } from '../sounds';
import { announceOrderChanges } from '../orderEvents';
import { ingestOrders } from '../actionQueue';
import { actionFor, runAction } from '../actions';
import OrderDetailModal from './OrderDetailModal';
import BingxAdModal from './BingxAdModal';
import { askConfirm } from './confirm';
import { RefreshCw, Clock, AlertTriangle, MessageSquare, Coins, CheckCircle2, WifiOff, Megaphone, ListOrdered, Plus, Pencil, Pause, Play, MoreVertical, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * BingX merchant panel — the thinner sibling of MerchantPanel.
 *
 * Same data contract (the backend already translated BingX orders into the
 * house shape), same shared pieces (announceOrderChanges, actionFor/runAction,
 * OrderDetailModal), but WITHOUT the MEXC-only controls (service switch,
 * balance) — BingX has no equivalent. Ads: quick price, list/delist,
 * pause-all (= delist every live ad, the only way to "close shop" on BingX),
 * and full edit/create through BingxAdModal. Keeping this component separate
 * means MerchantPanel stays exactly as it was.
 */

const ORDER_FILTERS = [
  { key: 'all',       label: 'Semua',   states: null },
  { key: 'active',    label: 'Aktif',   states: [0, 1, 2, 3, 9, 10] },
  { key: 'done',      label: 'Selesai', states: [4] },
  { key: 'cancelled', label: 'Batal',   states: [5, 6, 7, 8] },
];
const RUNNING = [0, 1, 2, 3, 9, 10];

function fmtRemaining(ms) {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export default function BingxPanel({ merchant, dateRange, refreshKey, autoRefresh }) {
  const [orders, setOrders]         = useState([]);
  const [ads, setAds]               = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError]   = useState(false);
  const syncErrorRef = useRef(false);
  const [now, setNow]               = useState(Date.now());
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [openChatOrder, setOpenChatOrder] = useState(null); // open the modal straight on the chat tab
  const [tab, setTab]               = useState('orders');
  const [orderFilter, setOrderFilter] = useState('all');
  const [rowBusy, setRowBusy]       = useState(null);
  const [rowDone, setRowDone]       = useState(null);
  const [nameMap, setNameMap]       = useState({});   // advOrderNo -> { realName, nickName }
  const nameMapRef = useRef({});
  // Ads
  const [showAdModal, setShowAdModal] = useState(false);
  const [editAd, setEditAd]           = useState(null);
  const [priceEdit, setPriceEdit]     = useState(null); // { advNo, value } while the inline price box is open
  const [adBusy, setAdBusy]           = useState(null); // advNo mid-request
  const [pausedAds, setPausedAds]     = useState([]);
  const [balance, setBalance]         = useState(null); // { free, locked, source } from the fund account
  const [busyTrading, setBusyTrading] = useState(false);
  const [menuOpen, setMenuOpen]       = useState(false);
  const menuRef = useRef(null);

  const prevStates  = useRef({});
  const prevUnread  = useRef({});
  const initialized = useRef(false);
  const busyRef     = useRef(false);
  const rangeRef    = useRef(dateRange);
  const ordersRef   = useRef([]);
  useEffect(() => { rangeRef.current = dateRange; }, [dateRange]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { merchantApi.getPauseState(merchant.id).then(r => setPausedAds(r.data?.ads || [])).catch(() => {}); }, [merchant.id]);
  const fetchBalance = useCallback(() => { merchantApi.balance(merchant.id).then(r => setBalance(r.data || null)).catch(() => {}); }, [merchant.id]);
  useEffect(() => { fetchBalance(); const t = setInterval(fetchBalance, 30000); return () => clearInterval(t); }, [fetchBalance]);
  useEffect(() => {
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // KYC names per row — the backend resolves them from order detail and caches
  // them, so each order costs one BingX call, ever. Active orders first.
  useEffect(() => {
    if (orders.length === 0) return;
    const pending = orders.filter(o => o.advOrderNo && !(o.advOrderNo in nameMapRef.current));
    const active = pending.filter(o => RUNNING.includes(o._state));
    const rest = pending.filter(o => !RUNNING.includes(o._state));
    const missing = active.concat(rest).slice(0, 20).map(o => o.advOrderNo);
    if (missing.length === 0) return;
    let cancelled = false;
    ordersApi.memberIds(merchant.id, missing).then(r => {
      if (cancelled) return;
      const map = r.data?.map || {};
      setNameMap(prev => { const next = { ...prev, ...map }; nameMapRef.current = next; return next; });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [orders, merchant.id]);

  const doFetch = useCallback(async (quiet = false, quick = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (!quiet) setRefreshing(true);
    try {
      const params = {
        startTime: rangeRef.current.startTime,
        endTime: ['custom', 'lastEvent'].includes(rangeRef.current.kind) ? rangeRef.current.endTime : Date.now(),
      };
      const r = quick
        ? await ordersApi.marketQuick(merchant.id, params)
        : await ordersApi.market(merchant.id, params);
      const raw = r.data;
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
      let normalized = list.map(o => ({ ...o, _state: normalizeState(o.state), platform: 'bingx' }));
      if (quick) {
        // Quick = every running order + the newest finished ones. Rows outside
        // that set are carried over from the last full fetch, then clipped.
        const fresh = new Set(normalized.map(o => o.advOrderNo));
        const kept = ordersRef.current.filter(o => !fresh.has(o.advOrderNo));
        const fixedEnd = ['custom', 'lastEvent'].includes(rangeRef.current.kind) ? rangeRef.current.endTime : Infinity;
        normalized = normalized.concat(kept)
          .filter(o => (o.createTime || 0) >= rangeRef.current.startTime && (o.createTime || 0) <= fixedEnd)
          .sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
      }
      const { states: ns, unread: nu } = announceOrderChanges({
        merchantId: merchant.id,
        merchantName: `${merchant.name} (BingX)`,
        orders: normalized,
        prevStates: prevStates.current,
        prevUnread: prevUnread.current,
        first: !initialized.current,
      });
      prevStates.current = ns; prevUnread.current = nu; initialized.current = true;
      ordersRef.current = normalized;
      ingestOrders(merchant.id, merchant.name, 'bingx', normalized); // queue sees it the same instant
      setOrders(normalized); setSyncError(false); syncErrorRef.current = false;
    } catch (e) {
      if (!syncErrorRef.current) playSound('error');
      syncErrorRef.current = true;
      setSyncError(true);
      if (!quiet) toast.error(`Gagal memuat order BingX — ${merchant.name}. ${e.response?.data?.error || 'Cek koneksi atau API key.'}`);
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

  useEffect(() => {
    initialized.current = false; prevStates.current = {}; prevUnread.current = {};
    setOrders([]); setLoading(true);
    doFetch(false); fetchAds();
  }, [merchant.id, dateRange]); // eslint-disable-line

  useEffect(() => { if (refreshKey > 0) { doFetch(false); fetchAds(); } }, [refreshKey]); // eslint-disable-line

  useEffect(() => {
    if (!autoRefresh) return;
    const o = setInterval(() => doFetch(true, true), 5000);
    const a = setInterval(() => fetchAds(), 30000); // same cadence as the MEXC panel
    return () => { clearInterval(o); clearInterval(a); };
  }, [doFetch, fetchAds, autoRefresh]);

  async function rowAction(order, e) {
    e?.stopPropagation();
    if (rowBusy) return;
    setRowBusy(order.advOrderNo);
    try {
      const ok = await runAction(merchant.id, order);
      if (ok) {
        setRowDone(order.advOrderNo);
        setTimeout(() => setRowDone(null), 1200);
        doFetch(false, true); fetchBalance();
      }
    } finally { setRowBusy(null); }
  }

  // ── Ads ─────────────────────────────────────────────────────────────
  async function setAdStatus(ad, status) {
    const r = await adsApi.toggleStatus(merchant.id, { advNo: ad.advNo }, status);
    return r.data || {};
  }
  async function toggleAd(ad) {
    if (adBusy) return;
    const to = ad.advStatus === 'OPEN' ? 'CLOSE' : 'OPEN';
    setAdBusy(ad.advNo);
    try {
      const d = await setAdStatus(ad, to);
      if (d.code === 0) { toast.success(to === 'OPEN' ? 'Iklan tayang' : 'Iklan diturunkan'); fetchAds(); }
      else toast.error(`BingX menolak: ${d.msg || 'error'}`);
    } catch (e) { toast.error(e.response?.data?.msg || e.message); }
    finally { setAdBusy(null); }
  }
  async function saveQuickPrice(ad) {
    if (!priceEdit || priceEdit.advNo !== ad.advNo) return;
    const v = String(priceEdit.value).trim();
    if (!(Number(v) > 0)) { toast.error('Harga harus angka lebih dari 0'); return; }
    if (v === String(ad.priceType === 2 ? ad.floatRatio : ad.price)) { setPriceEdit(null); return; }
    setAdBusy(ad.advNo);
    try {
      const r = await adsApi.setPrice(merchant.id, ad.priceType === 2
        ? { advNo: ad.advNo, priceType: 2, floatRatio: v }
        : { advNo: ad.advNo, priceType: 1, fixedPrice: v });
      if (r.data?.code === 0) { toast.success(`Harga → ${v}${ad.priceType === 2 ? '%' : ''}`); setPriceEdit(null); fetchAds(); }
      else toast.error(`BingX menolak: ${r.data?.msg || 'error'}`);
    } catch (e) { toast.error(e.response?.data?.msg || e.message); }
    finally { setAdBusy(null); }
  }
  async function pauseTrading() {
    setMenuOpen(false);
    if (busyTrading) return;
    const openAds = ads.filter(a => a.advStatus === 'OPEN');
    if (openAds.length === 0) { toast.error(`${merchant.name}: tidak ada iklan tayang`); return; }
    if (!await askConfirm({ title: `Jeda — ${merchant.name} (BingX)`, message: `Menurunkan ${openAds.length} iklan tayang dan mengingatnya. "Lanjutkan" menayangkan kembali iklan yang sama.`, confirmText: 'Turunkan semua', danger: true })) return;
    setBusyTrading(true);
    const tid = toast.loading('Menurunkan iklan…');
    try {
      const closed = [], failed = [];
      for (const ad of openAds) {
        try { const d = await setAdStatus(ad, 'CLOSE'); if (d.code === 0) closed.push(ad.advNo); else failed.push(`#${ad.advNo}: ${d.msg || 'error'}`); }
        catch (e) { failed.push(`#${ad.advNo}: ${e.response?.data?.msg || e.message}`); }
      }
      await merchantApi.setPauseState(merchant.id, closed.length > 0, closed).catch(() => {});
      setPausedAds(closed); fetchAds();
      if (failed.length === 0) toast.success(`Dijeda — ${closed.length} iklan diturunkan`, { id: tid });
      else toast.error(`${closed.length} diturunkan, ${failed.length} gagal: ${failed.join('; ')}`, { id: tid, duration: 10000 });
    } finally { setBusyTrading(false); }
  }
  async function resumeTrading() {
    setMenuOpen(false);
    if (busyTrading) return;
    setBusyTrading(true);
    const tid = toast.loading('Menayangkan kembali…');
    try {
      let snapshot = pausedAds;
      try { const r = await merchantApi.getPauseState(merchant.id); snapshot = r.data?.ads || pausedAds; } catch { /* keep */ }
      const targets = ads.filter(a => snapshot.includes(a.advNo));
      if (targets.length === 0) {
        await merchantApi.setPauseState(merchant.id, false, []).catch(() => {});
        setPausedAds([]); toast.error('Tidak ada iklan yang dijeda', { id: tid }); return;
      }
      const failedNos = []; let ok = 0;
      for (const ad of targets) {
        try { const d = await setAdStatus(ad, 'OPEN'); if (d.code === 0) ok++; else failedNos.push(ad.advNo); }
        catch { failedNos.push(ad.advNo); }
      }
      await merchantApi.setPauseState(merchant.id, failedNos.length > 0, failedNos).catch(() => {});
      setPausedAds(failedNos); fetchAds();
      if (failedNos.length === 0) toast.success(`${ok} iklan tayang lagi`, { id: tid });
      else toast.error(`${ok} tayang, ${failedNos.length} gagal — tekan Lanjutkan lagi`, { id: tid, duration: 10000 });
    } finally { setBusyTrading(false); }
  }

  // Derived
  const filteredOrders = orders.filter(o => {
    const f = ORDER_FILTERS.find(f => f.key === orderFilter);
    return !f?.states || f.states.includes(o._state);
  }).slice().sort((a, b) => {
    const aActive = RUNNING.includes(a._state), bActive = RUNNING.includes(b._state);
    if (aActive && bActive) return (a.payTimeLimit || Infinity) - (b.payTimeLimit || Infinity);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return (b.createTime || 0) - (a.createTime || 0);
  });
  const activeOrders = orders.filter(o => RUNNING.includes(o._state));
  const unread = orders.reduce((a, o) => a + (o.unreadCount || 0), 0);
  const doneOrders = orders.filter(o => o._state === 4);
  const volSell = doneOrders.filter(o => o.side === 'SELL').reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
  const volSellUsdt = doneOrders.filter(o => o.side === 'SELL').reduce((s, o) => s + (parseFloat(o.tradableQuantity) || 0), 0);
  const fiatUnit = orders[0]?.fiatUnit || ads[0]?.fiatUnit || 'IDR';
  const liveAds = ads.filter(a => a.advStatus === 'OPEN');
  const filterCounts = ORDER_FILTERS.reduce((acc, f) => {
    acc[f.key] = f.states ? orders.filter(o => f.states.includes(o._state)).length : orders.length;
    return acc;
  }, {});

  return (
    <div className="card flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-3 sm:px-3.5 pt-3 pb-3 border-b border-surface-700">
        <div className="flex items-center justify-between h-6">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/brand/bingx.png" alt="BingX" className="w-5 h-5 rounded-md flex-shrink-0 bg-white" />
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${syncError ? 'bg-sell' : 'bg-warning shadow-glow-sm animate-pulse'}`} />
            <span className="font-semibold text-surface-50 text-sm truncate">{merchant.name}</span>
            <PlatformBadge platform="bingx" />
            {refreshing && <RefreshCw size={11} className="text-brand-400 animate-spin flex-shrink-0" />}
            {syncError && <span className="flex items-center gap-1 bg-sell/15 text-sell text-xs rounded px-1.5 py-0.5 font-medium flex-shrink-0"><WifiOff size={11} /> sync gagal</span>}
            {unread > 0 && <span className="bg-sell/15 text-sell text-xs rounded px-1.5 py-0.5 font-medium flex-shrink-0">{unread} belum dibaca</span>}
            {pausedAds.length > 0 && <span className="bg-warning/15 text-warning text-xs rounded px-1.5 py-0.5 font-medium flex-shrink-0">{pausedAds.length} dijeda</span>}
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={() => { doFetch(false); fetchAds(); }} title="Refresh panel ini"
              className="w-7 h-7 flex items-center justify-center rounded-md text-surface-300 hover:text-surface-50 hover:bg-surface-700 transition-colors">
              <RefreshCw size={14} />
            </button>
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenuOpen(m => !m)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-surface-300 hover:text-surface-50 hover:bg-surface-700 transition-colors">
                <MoreVertical size={15} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-20 w-56 bg-surface-800 border border-surface-700 rounded-lg p-1 shadow-xl shadow-black/40">
                  <button onClick={pauseTrading} disabled={busyTrading}
                    className="w-full flex items-center gap-2 text-xs rounded px-2 py-1.5 transition-colors disabled:opacity-40 text-warning hover:bg-warning/10">
                    <Pause size={13} /> Jeda — turunkan semua iklan
                  </button>
                  {pausedAds.length > 0 && (
                    <button onClick={resumeTrading} disabled={busyTrading}
                      className="w-full flex items-center gap-2 text-xs rounded px-2 py-1.5 transition-colors disabled:opacity-40 text-buy hover:bg-buy/10">
                      <Play size={13} /> Lanjutkan — tayangkan {pausedAds.length} iklan
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {[
            ['Saldo USDT', balance === null ? '…' : (balance.free === null ? 'n/a' : formatAmount(balance.free, 2)), 'text-buy', balance?.error ? `Saldo tidak terbaca: ${balance.error}` : (balance?.source ? `Akun ${balance.source}${Number(balance.locked) > 0 ? ` · terkunci ${formatAmount(balance.locked, 2)}` : ''}` : '')],
            ['Aktif', activeOrders.length, activeOrders.length > 0 ? 'text-brand-300' : 'text-surface-100'],
            [`Jual (${fiatUnit})`, formatAmount(volSell, 0), 'text-sell'],
            ['USDT keluar', formatAmount(volSellUsdt, 2), 'text-surface-100'],
          ].map(([l, v, c, title]) => (
            <div key={l} className="bg-surface-900 rounded-lg px-2.5 py-2" title={title || undefined}>
              <p className="text-[10px] uppercase tracking-wide text-surface-300 truncate">{l}</p>
              <p className={`text-sm font-mono font-semibold tnum truncate ${c}`}>{v}</p>
            </div>
          ))}
        </div>

        {/* Tabs + filters */}
        <div className="flex items-center gap-1 mt-3">
          {[['orders', 'Order', ListOrdered, orders.length], ['ads', 'Iklan', Megaphone, `${liveAds.length}/${ads.length}`]].map(([k, l, Icon, n]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 text-xs rounded-lg px-2.5 h-7 border transition-colors ${
                tab === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'text-surface-300 border-surface-700 hover:text-surface-50'}`}>
              <Icon size={12} /> {l} <span className="text-[10px] opacity-70">{n}</span>
            </button>
          ))}
        </div>
        {tab === 'orders' && (
          <div className="flex gap-1 mt-2 overflow-x-auto no-scrollbar">
            {ORDER_FILTERS.map(f => (
              <button key={f.key} onClick={() => setOrderFilter(f.key)}
                className={`flex-shrink-0 text-[11px] rounded-md px-2 py-1 border transition-colors ${
                  orderFilter === f.key ? 'bg-surface-700 text-surface-50 border-surface-600' : 'text-surface-300 border-transparent hover:text-surface-50'}`}>
                {f.label} <span className="opacity-60">{filterCounts[f.key]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 space-y-2.5">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[68px] w-full" />)}
          </div>
        ) : tab === 'orders' ? (
          filteredOrders.length === 0 ? (
            <div className="text-center py-12 px-6">
              <p className="text-sm text-surface-200">{orders.length === 0 ? 'Belum ada order BingX pada rentang ini.' : 'Tidak ada order dengan filter ini.'}</p>
              <p className="text-xs text-surface-300 mt-1">{orders.length === 0 ? 'Coba ubah rentang tanggal di kanan atas.' : 'Pilih filter lain untuk melihat order yang ada.'}</p>
            </div>
          ) : filteredOrders.map(order => {
            const amtColor = order.side === 'BUY' ? 'text-buy' : 'text-sell';
            const isActive = RUNNING.includes(order._state);
            const remaining = isActive && order.payTimeLimit ? order.payTimeLimit - now : 0;
            const countdown = fmtRemaining(remaining);
            const urgent = countdown && remaining < 5 * 60 * 1000;
            return (
              <div key={order.advOrderNo}
                className={`border-b border-surface-700/60 hover:bg-surface-900/60 transition-colors border-l-2 ${ORDER_STATES[order._state]?.accent || 'border-l-transparent'}`}>
                <button onClick={() => setSelectedOrder(order.advOrderNo)} className="w-full px-3 sm:px-3.5 py-3 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <SideBadge side={order.side} />
                        <OrderStateBadge state={order._state} />
                        {order.unreadCount > 0 && (
                          <button onClick={e => { e.stopPropagation(); setOpenChatOrder(order.advOrderNo); }}
                            title={`${order.unreadCount} pesan belum dibaca — buka chat`}
                            className="inline-flex items-center gap-0.5 text-[11px] font-semibold rounded-md px-1.5 py-0.5 bg-sell/15 text-sell hover:bg-sell/25 transition-colors">
                            <MessageSquare size={10} />{order.unreadCount}
                          </button>
                        )}
                        {countdown && (
                          <span className={`flex items-center gap-0.5 text-[11px] font-mono tnum rounded-md px-1.5 py-0.5 ${urgent ? 'bg-sell/15 text-sell animate-pulse-ring' : 'bg-warning/10 text-warning'}`}>
                            {urgent ? <AlertTriangle size={10} /> : <Clock size={10} />}{countdown}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-200 truncate">{order.userInfo?.nickName || 'Unknown'}</p>
                      {nameMap[order.advOrderNo]?.realName && (
                        <p className="text-xs truncate text-surface-100">{nameMap[order.advOrderNo].realName}</p>
                      )}
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
              </div>
            );
          })
        ) : (
          <div className="p-2.5 sm:p-3 space-y-2.5">
            <button onClick={() => { setEditAd(null); setShowAdModal(true); }}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg h-9 border border-dashed border-surface-600 text-surface-200 hover:text-surface-50 hover:border-surface-500 transition-colors">
              <Plus size={13} /> Iklan baru
            </button>
            {ads.length === 0 ? (
              <div className="text-center py-10 px-6">
                <p className="text-sm text-surface-200">Belum ada iklan.</p>
                <p className="text-xs text-surface-300 mt-1">Buat dari tombol di atas — langsung tayang di pasar BingX.</p>
              </div>
            ) : ads.map(ad => {
              const busy = adBusy === ad.advNo;
              const editing = priceEdit?.advNo === ad.advNo;
              const live = ad.advStatus === 'OPEN';
              return (
                <div key={ad.advNo} className={`bg-surface-900 border rounded-lg p-3 ${live ? 'border-surface-700' : 'border-surface-700/60 opacity-80'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <SideBadge side={ad.side} />
                      <AdStatusBadge status={ad.advStatus} />
                      {pausedAds.includes(ad.advNo) && <span className="text-[10px] text-warning">dijeda</span>}
                    </div>
                    {editing ? (
                      <div className="flex items-center gap-1">
                        <input autoFocus value={priceEdit.value} inputMode="decimal"
                          onChange={e => setPriceEdit({ advNo: ad.advNo, value: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') saveQuickPrice(ad); if (e.key === 'Escape') setPriceEdit(null); }}
                          className="w-24 bg-surface-950 border border-brand-500/50 rounded-md px-2 py-1 text-sm font-mono text-surface-50 text-right focus:outline-none" />
                        <span className="text-[11px] text-surface-300">{ad.priceType === 2 ? '%' : ad.fiatUnit}</span>
                        <button onClick={() => saveQuickPrice(ad)} disabled={busy} title="Simpan (Enter)"
                          className="w-7 h-7 flex items-center justify-center rounded-md bg-buy/15 text-buy hover:bg-buy/25 disabled:opacity-50">
                          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Check size={13} />}
                        </button>
                        <button onClick={() => setPriceEdit(null)} title="Batal (Esc)"
                          className="w-7 h-7 flex items-center justify-center rounded-md text-surface-300 hover:bg-surface-700"><X size={13} /></button>
                      </div>
                    ) : (
                      <button onClick={() => setPriceEdit({ advNo: ad.advNo, value: ad.priceType === 2 ? ad.floatRatio : ad.price })}
                        title="Ubah harga (satu panggilan modifyPrice)"
                        className="group flex items-center gap-1.5 text-sm font-mono font-semibold tnum text-surface-50 hover:text-brand-300 transition-colors">
                        {ad.priceType === 2 ? `${ad.floatRatio}% mengambang` : `${formatAmount(ad.price, 2)} ${ad.fiatUnit}`}
                        <Pencil size={11} className="text-surface-300 group-hover:text-brand-300" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-surface-300">
                    <span>Sisa: <b className="text-surface-100 font-mono">{formatAmount(ad.availableAmount, 2)}</b> / {formatAmount(ad.totalNumber, 2)} USDT</span>
                    <span className="col-span-2">Limit: <b className="text-surface-100 font-mono">{formatAmount(ad.minAmount, 0)} – {formatAmount(ad.maxAmount, 0)} {ad.fiatUnit}</b></span>
                    <span className="col-span-2 truncate">Bayar: <b className="text-surface-100">{ad.payMethodNames?.length ? ad.payMethodNames.join(' · ') : '-'}</b>{ad.hidePaymentInfo === 1 ? ' · info bayar disembunyikan' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2.5">
                    <button onClick={() => toggleAd(ad)} disabled={busy || busyTrading}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg h-8 border transition-colors disabled:opacity-50 ${
                        live ? 'bg-warning/10 text-warning border-warning/25 hover:bg-warning/20' : 'bg-buy/10 text-buy border-buy/25 hover:bg-buy/20'}`}>
                      {busy && !editing ? <RefreshCw size={12} className="animate-spin" /> : live ? <><Pause size={12} /> Turunkan</> : <><Play size={12} /> Tayangkan</>}
                    </button>
                    <button onClick={() => { setEditAd(ad); setShowAdModal(true); }} disabled={busy}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg h-8 border border-surface-600 text-surface-100 hover:bg-surface-700 transition-colors disabled:opacity-50">
                      <Pencil size={12} /> Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderDetailModal merchantId={merchant.id} advOrderNo={selectedOrder} initialTab="detail"
          onClose={() => { setSelectedOrder(null); doFetch(true, true); }}
          onActionDone={() => doFetch(false, true)} />
      )}
      {openChatOrder && (
        <OrderDetailModal merchantId={merchant.id} advOrderNo={openChatOrder} initialTab="chat"
          onClose={() => { setOpenChatOrder(null); doFetch(true, true); }}
          onActionDone={() => doFetch(false, true)} />
      )}
      {showAdModal && (
        <BingxAdModal merchant={merchant} existingAd={editAd}
          onClose={() => { setShowAdModal(false); setEditAd(null); }}
          onSaved={() => { fetchAds(); fetchBalance(); }} />
      )}
    </div>
  );
}

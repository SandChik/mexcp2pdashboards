import { useState, useEffect, useCallback, useRef } from 'react';
import { ordersApi, adsApi } from '../api';
import {
  OrderStateBadge, SideBadge, AdStatusBadge, PlatformBadge, formatTime, formatAmount, formatCompact,
  ORDER_STATES, normalizeState,
} from './helpers';
import { playSound } from '../sounds';
import { announceOrderChanges } from '../orderEvents';
import { actionFor, runAction } from '../actions';
import OrderDetailModal from './OrderDetailModal';
import { RefreshCw, Clock, AlertTriangle, MessageSquare, Coins, CheckCircle2, WifiOff, Megaphone, ListOrdered } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * BingX merchant panel — the thinner sibling of MerchantPanel.
 *
 * Same data contract (the backend already translated BingX orders into the
 * house shape), same shared pieces (announceOrderChanges, actionFor/runAction,
 * OrderDetailModal), but deliberately WITHOUT the MEXC-only controls
 * (service switch, balance, pause, ad editing) — BingX has no equivalent for
 * the first two, and ad management is a later slice. Keeping it separate
 * means MerchantPanel stays exactly as it was.
 */

const ORDER_FILTERS = [
  { key: 'all',       label: 'Semua',   states: null },
  { key: 'active',    label: 'Aktif',   states: [0, 1, 2, 3, 9] },
  { key: 'done',      label: 'Selesai', states: [4] },
  { key: 'cancelled', label: 'Batal',   states: [5, 6, 7, 8] },
];
const RUNNING = [0, 1, 2, 3, 9];

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
  const [tab, setTab]               = useState('orders');
  const [orderFilter, setOrderFilter] = useState('all');
  const [rowBusy, setRowBusy]       = useState(null);
  const [rowDone, setRowDone]       = useState(null);
  const [nameMap, setNameMap]       = useState({});   // advOrderNo -> { realName, nickName }
  const nameMapRef = useRef({});

  const prevStates  = useRef({});
  const prevUnread  = useRef({});
  const initialized = useRef(false);
  const busyRef     = useRef(false);
  const rangeRef    = useRef(dateRange);
  const ordersRef   = useRef([]);
  useEffect(() => { rangeRef.current = dateRange; }, [dateRange]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

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
        endTime: rangeRef.current.kind === 'custom' ? rangeRef.current.endTime : Date.now(),
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
        normalized = normalized.concat(kept)
          .filter(o => (o.createTime || 0) >= rangeRef.current.startTime)
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
    const a = setInterval(() => fetchAds(), 60000);
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
        doFetch(false, true);
      }
    } finally { setRowBusy(null); }
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
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${syncError ? 'bg-sell' : 'bg-warning shadow-glow-sm animate-pulse'}`} />
            <span className="font-semibold text-surface-50 text-sm truncate">{merchant.name}</span>
            <PlatformBadge platform="bingx" />
            {refreshing && <RefreshCw size={11} className="text-brand-400 animate-spin flex-shrink-0" />}
            {syncError && <span className="flex items-center gap-1 bg-sell/15 text-sell text-xs rounded px-1.5 py-0.5 font-medium flex-shrink-0"><WifiOff size={11} /> sync gagal</span>}
            {unread > 0 && <span className="bg-sell/15 text-sell text-xs rounded px-1.5 py-0.5 font-medium flex-shrink-0" title="Balas lewat aplikasi BingX — chat di dashboard menyusul">{unread} belum dibaca</span>}
          </div>
          <button onClick={() => { doFetch(false); fetchAds(); }} title="Refresh panel ini"
            className="w-7 h-7 flex items-center justify-center rounded-md text-surface-300 hover:text-surface-50 hover:bg-surface-700 transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            ['Aktif', activeOrders.length, activeOrders.length > 0 ? 'text-brand-300' : 'text-surface-100'],
            [`Jual (${fiatUnit})`, formatCompact(volSell), 'text-sell'],
            ['USDT keluar', formatCompact(volSellUsdt), 'text-surface-100'],
          ].map(([l, v, c]) => (
            <div key={l} className="bg-surface-900 rounded-lg px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-surface-300 truncate">{l}</p>
              <p className={`text-sm font-mono font-semibold tnum ${c}`}>{v}</p>
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
                          <span title={`${order.unreadCount} pesan belum dibaca — balas di aplikasi BingX`}
                            className="inline-flex items-center gap-0.5 text-[11px] font-semibold rounded-md px-1.5 py-0.5 bg-sell/15 text-sell">
                            <MessageSquare size={10} />{order.unreadCount}
                          </span>
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
          ads.length === 0 ? (
            <div className="text-center py-12 px-6">
              <p className="text-sm text-surface-200">Belum ada iklan.</p>
              <p className="text-xs text-surface-300 mt-1">Buat iklan lewat aplikasi BingX, lalu refresh panel ini. Kelola iklan dari dashboard menyusul.</p>
            </div>
          ) : (
            <div className="p-2.5 sm:p-3 space-y-2.5">
              {ads.map(ad => (
                <div key={ad.advNo} className="bg-surface-900 border border-surface-700 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <SideBadge side={ad.side} />
                      <AdStatusBadge status={ad.advStatus} />
                    </div>
                    <span className="text-sm font-mono font-semibold tnum text-surface-50">
                      {ad.priceType === 2 ? `${ad.floatRatio}% mengambang` : `${formatAmount(ad.price, 2)} ${ad.fiatUnit}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-surface-300">
                    <span>Sisa: <b className="text-surface-100 font-mono">{formatAmount(ad.availableAmount, 2)}</b> / {formatAmount(ad.totalNumber, 2)} USDT</span>
                    <span>Limit: <b className="text-surface-100 font-mono">{formatCompact(ad.minAmount)} – {formatCompact(ad.maxAmount)}</b></span>
                    <span className="col-span-2 truncate">Bayar: <b className="text-surface-100">{ad.payMethodNames?.length ? ad.payMethodNames.join(' · ') : '-'}</b>{ad.hidePaymentInfo === 1 ? ' · info bayar disembunyikan' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {selectedOrder && (
        <OrderDetailModal merchantId={merchant.id} advOrderNo={selectedOrder} initialTab="detail"
          onClose={() => setSelectedOrder(null)}
          onActionDone={() => doFetch(false, true)} />
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '../components/Layout';
import OrderDetailModal from '../components/OrderDetailModal';
import { formatAmount, formatTime, getBankName, SideBadge, OrderStateBadge } from '../components/helpers';
import { runAction, actionFor } from '../actions';
import { getQueue, subscribeQueue, refreshQueue, removeFromQueue, getQueueMeta } from '../actionQueue';
import { ordersApi, registryApi } from '../api';
import { Zap, RefreshCw, Keyboard, CheckCircle2, Coins, AlertTriangle, Clock, ExternalLink, Copy, User, Landmark } from 'lucide-react';
import toast from 'react-hot-toast';

function fmtRemaining(ms) {
  if (!ms || ms <= 0) return null;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}
const normName = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const KYC = ['None', 'Primary', 'Advanced'];

export default function ActionQueue() {
  const [, tick] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(null);
  const [doneFlash, setDoneFlash] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [detailOrder, setDetailOrder] = useState(null);
  const [showKeys, setShowKeys] = useState(false);
  const [details, setDetails] = useState({});   // advOrderNo -> full order detail
  const [nameIdx, setNameIdx] = useState({});   // merchantId -> { normalisedName: [advOrderNo] }
  const rowsRef = useRef([]);
  const fetchingRef = useRef(new Set());

  useEffect(() => subscribeQueue(() => tick(t => t + 1)), []);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const items = getQueue();
  const meta = getQueueMeta();

  // Fetch each queued order's detail ONCE and keep it, so every row carries
  // what you need to decide — opening a modal per order defeats the point.
  useEffect(() => {
    const missing = items.filter(o => !details[o.advOrderNo] && !fetchingRef.current.has(o.advOrderNo));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < missing.length; i += 3) {        // small batches — the
        const batch = missing.slice(i, i + 3);             // backend rate-limits
        batch.forEach(o => fetchingRef.current.add(o.advOrderNo));
        const got = await Promise.all(batch.map(async o => {
          try {
            const r = await ordersApi.detail(o.merchantId, o.advOrderNo);
            return [o.advOrderNo, r.data?.data || r.data || null];
          } catch { return [o.advOrderNo, null]; }
          finally { fetchingRef.current.delete(o.advOrderNo); }
        }));
        if (cancelled) return;
        setDetails(prev => {
          const next = { ...prev };
          got.forEach(([no, d]) => { if (d) next[no] = d; });
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [items, details]);

  // Buyer-log name index → warn BEFORE releasing if this KYC name already ordered.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const entries = await Promise.all((meta.merchants || []).map(async m => {
        try { const r = await registryApi.list(m.id); return [m.id, r.data?.nameIndex || {}]; }
        catch { return [m.id, {}]; }
      }));
      if (!stop) setNameIdx(Object.fromEntries(entries));
    };
    if (meta.merchants?.length) {
      load();
      const i = setInterval(load, 60000);
      return () => { stop = true; clearInterval(i); };
    }
    return () => { stop = true; };
  }, [meta.merchants?.length]); // eslint-disable-line

  useEffect(() => { if (cursor >= items.length) setCursor(Math.max(0, items.length - 1)); }, [items.length, cursor]);

  const act = useCallback(async (order) => {
    if (!order || busy) return;
    setBusy(order.advOrderNo);
    try {
      const ok = await runAction(order.merchantId, order);
      if (ok) {
        setDoneFlash(order.advOrderNo);
        setTimeout(() => { removeFromQueue(order.advOrderNo); setDoneFlash(null); }, 900);
        refreshQueue();
      }
    } finally { setBusy(null); }
  }, [busy]);

  const copy = (v, label) => { navigator.clipboard.writeText(String(v)); toast.success(`${label} disalin`, { duration: 1200 }); };

  useEffect(() => {
    const onKey = (e) => {
      if (detailOrder) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const k = e.key.toLowerCase();
      if (k === '?') { setShowKeys(s => !s); return; }
      if (k === 'escape') { setShowKeys(false); return; }
      if (items.length === 0) return;
      if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(items.length - 1, c + 1)); }
      else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
      else if (k === 'r' && actionFor(items[cursor]) === 'release') { e.preventDefault(); act(items[cursor]); }
      else if (k === 'c' && actionFor(items[cursor]) === 'confirm') { e.preventDefault(); act(items[cursor]); }
      else if (e.key === 'Enter') { e.preventDefault(); act(items[cursor]); }
      else if (k === 'd') { e.preventDefault(); setDetailOrder(items[cursor]); }
      else if (k === 'g') { e.preventDefault(); refreshQueue(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, cursor, act, detailOrder]);

  useEffect(() => {
    const el = rowsRef.current[cursor];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const Field = ({ label, value, mono }) => (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-surface-300">{label}</p>
      {value === null || value === undefined
        ? <span className="skeleton inline-block h-3 w-16 mt-0.5" />
        : <p className={`text-xs text-surface-100 truncate ${mono ? 'font-mono tnum' : ''}`}>{value}</p>}
    </div>
  );

  return (
    <Layout>
      <div className="h-[100dvh] flex flex-col bg-surface-950 overflow-hidden">

        <header className="glass border-b flex items-center gap-2 px-3 sm:px-4 h-14 flex-shrink-0">
          <Zap size={17} className="text-brand-300 flex-shrink-0" />
          <h1 className="font-display font-semibold text-surface-50 text-[15px]">Antrian</h1>
          <span className={`text-xs rounded-md px-2 py-0.5 font-semibold ${items.length ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-800 text-surface-300'}`}>
            {items.length}
          </span>
          <span className="hidden sm:inline text-xs text-surface-300 truncate">
            {meta.merchants.length} merchant{meta.lastError ? ' · sebagian gagal dimuat' : ''}
          </span>
          <div className="flex-1" />
          <button onClick={() => setShowKeys(s => !s)} title="Pintasan keyboard (?)"
            className="hidden md:flex w-8 h-8 items-center justify-center text-surface-300 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-lg transition-colors">
            <Keyboard size={14} />
          </button>
          <button onClick={refreshQueue} title="Refresh (G)"
            className="w-8 h-8 flex items-center justify-center text-surface-200 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
        </header>

        {showKeys && (
          <div className="hidden md:flex flex-wrap gap-x-5 gap-y-1 px-4 py-2 border-b border-surface-700 bg-surface-900 text-[11px] text-surface-300">
            {[['J / ↓', 'turun'], ['K / ↑', 'naik'], ['R', 'release'], ['C', 'konfirmasi bayar'], ['Enter', 'jalankan aksi'], ['D', 'buka chat'], ['G', 'refresh'], ['?', 'tutup bantuan']].map(([k, d]) => (
              <span key={k}><kbd className="font-mono text-surface-100 bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5">{k}</kbd> {d}</span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-buy/10 border border-buy/25 flex items-center justify-center mb-1">
                <CheckCircle2 size={24} className="text-buy" />
              </div>
              <p className="text-surface-50 font-medium">Antrian kosong</p>
              <p className="text-sm text-surface-300 max-w-xs">Tidak ada order yang menunggu tindakan Anda saat ini.</p>
            </div>
          ) : items.map((o, i) => {
            const kind = actionFor(o);
            const d = details[o.advOrderNo];
            const remaining = o.payTimeLimit ? o.payTimeLimit - now : 0;
            const cd = fmtRemaining(remaining);
            const urgent = cd && remaining < 5 * 60 * 1000;
            const isBusy = busy === o.advOrderNo;
            const flashed = doneFlash === o.advOrderNo;
            const selected = i === cursor;

            const realName = d?.userInfo?.realName || null;
            const pay = d?.confirmPaymentInfo || d?.paymentInfo?.[0] || null;
            const priorCount = realName
              ? (nameIdx[o.merchantId]?.[normName(realName)] || []).filter(n => n !== o.advOrderNo).length
              : 0;

            return (
              <div key={o.advOrderNo} ref={el => rowsRef.current[i] = el}
                onMouseEnter={() => setCursor(i)}
                className={`border-b border-surface-700/60 border-l-2 transition-colors ${
                  flashed ? 'bg-buy/15 border-l-buy'
                  : priorCount > 0 ? 'bg-sell/[0.06] border-l-sell'
                  : selected ? 'bg-surface-900/70 border-l-brand-400'
                  : 'border-l-transparent hover:bg-surface-900/40'}`}>
                <div className="px-3 sm:px-4 py-3">

                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[11px] text-surface-300 font-medium">{o.merchantName}</span>
                        <SideBadge side={o.side} />
                        <OrderStateBadge state={o._state} />
                        {cd && (
                          <span className={`flex items-center gap-0.5 text-[11px] font-mono tnum rounded-md px-1.5 py-0.5 ${urgent ? 'bg-sell/15 text-sell animate-pulse-ring' : 'bg-warning/10 text-warning'}`}>
                            {urgent ? <AlertTriangle size={10} /> : <Clock size={10} />}{cd}
                          </span>
                        )}
                        {priorCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full pl-1.5 pr-2 py-0.5 bg-sell/15 text-sell ring-1 ring-sell/30"
                            title="Nama KYC ini sudah tercatat di Catatan Buyer">
                            <AlertTriangle size={11} /> Sudah pernah order ×{priorCount + 1}
                          </span>
                        )}
                      </div>

                      <p className="text-2xl sm:text-3xl font-mono font-semibold tnum leading-none text-surface-50">
                        {formatAmount(o.amount, 0)}
                        <span className="text-xs text-surface-300 font-sans font-normal ml-1.5">{o.fiatUnit}</span>
                        <button onClick={() => copy(o.amount, 'Nominal')} title="Salin nominal"
                          className="ml-1.5 align-middle text-surface-300 hover:text-brand-300 transition-colors"><Copy size={12} /></button>
                      </p>

                      <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
                        <User size={12} className="text-surface-300 flex-shrink-0" />
                        {realName
                          ? <span className={`text-sm font-medium truncate ${priorCount > 0 ? 'text-sell' : 'text-surface-50'}`}>{realName}</span>
                          : <span className="skeleton inline-block h-3.5 w-32" />}
                        <span className="text-[11px] text-surface-300 truncate">· {o.userInfo?.nickName || '—'}</span>
                      </div>

                      {pay && (
                        <div className="flex items-center gap-1.5 mt-1 min-w-0">
                          <Landmark size={12} className="text-surface-300 flex-shrink-0" />
                          <span className="text-xs text-surface-100 flex-shrink-0">{getBankName(pay.payMethod)}</span>
                          {pay.account && (
                            <button onClick={() => copy(pay.account, 'No. rekening')} title="Salin no. rekening"
                              className="text-xs font-mono text-surface-200 hover:text-brand-300 transition-colors truncate">
                              {pay.account}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <button onClick={() => act(o)} disabled={!!busy}
                      className={`flex-shrink-0 flex items-center justify-center gap-1.5 text-sm font-medium rounded-lg px-3 sm:px-4 h-11 min-w-[104px] sm:min-w-[132px] transition-all disabled:opacity-40 ${
                        kind === 'release'
                          ? 'bg-buy/15 text-buy border border-buy/30 hover:bg-buy/25 hover:shadow-glow-buy'
                          : 'bg-brand-500/15 text-brand-300 border border-brand-500/30 hover:bg-brand-500/25 hover:shadow-glow-sm'}`}>
                      {isBusy ? <RefreshCw size={15} className="animate-spin" />
                        : kind === 'release' ? <><Coins size={15} /> Release</>
                        : <><CheckCircle2 size={15} /> Konfirmasi</>}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mt-3 pt-2.5 border-t border-surface-700/50">
                    <Field label="Jumlah" value={`${formatAmount(o.tradableQuantity, 2)} USDT`} mono />
                    <Field label="Harga/USDT" value={d ? `${formatAmount(d.price, 0)} ${o.fiatUnit}` : null} mono />
                    <Field label="Dibuat" value={formatTime(o.createTime)} mono />
                    <Field label="KYC" value={d ? (KYC[d.userInfo?.kycLevel] || `Level ${d.userInfo?.kycLevel ?? '?'}`) : null} />
                  </div>

                  <button onClick={() => setDetailOrder(o)}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-surface-300 hover:text-brand-300 transition-colors">
                    <ExternalLink size={11} /> Buka chat
                    {o.unreadCount > 0 && <span className="ml-1 bg-sell/15 text-sell rounded px-1.5">{o.unreadCount} baru</span>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {detailOrder && (
        <OrderDetailModal merchantId={detailOrder.merchantId} advOrderNo={detailOrder.advOrderNo}
          initialTab="chat"
          onClose={() => { setDetailOrder(null); refreshQueue(); }}
          onActionDone={() => refreshQueue()} />
      )}
    </Layout>
  );
}

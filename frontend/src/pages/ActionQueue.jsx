import { useState, useEffect, useRef, useCallback } from 'react';
import { copyToClipboard } from '../clipboard';
import Layout from '../components/Layout';
import OrderDetailModal from '../components/OrderDetailModal';
import { formatAmount, formatTime, getBankName, SideBadge, OrderStateBadge, PlatformBadge, platformOf } from '../components/helpers';
import { runAction, actionFor } from '../actions';
import { getQueue, subscribeQueue, refreshQueue, getQueueMeta, getActionableCount, getNameIndex, isBuyerLogOn } from '../actionQueue';
import { ordersApi } from '../api';
import { announceDuplicate } from '../orderEvents';
import { Zap, RefreshCw, Keyboard, CheckCircle2, Coins, AlertTriangle, Clock, MessageSquare, Copy, User, Landmark, Hourglass, Store } from 'lucide-react';
import toast from 'react-hot-toast';

function fmtRemaining(ms) {
  if (!ms || ms <= 0) return null;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}
const normName = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const KYC = ['None', 'Primary', 'Advanced'];
// Merchant identity colours — enough contrast between neighbours that two
// accounts never read as one.
const MERCHANT_TONES = [
  { chip: 'bg-brand-500/15 text-brand-300 ring-brand-500/30', bar: 'bg-brand-400' },
  { chip: 'bg-buy/15 text-buy ring-buy/30',                   bar: 'bg-buy' },
  { chip: 'bg-warning/15 text-warning ring-warning/30',       bar: 'bg-warning' },
  { chip: 'bg-sell/15 text-sell ring-sell/30',                bar: 'bg-sell' },
];

export default function ActionQueue() {
  const [, tick] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(null);
  const [doneFlash, setDoneFlash] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [detailOrder, setDetailOrder] = useState(null);
  const [showKeys, setShowKeys] = useState(false);
  const [details, setDetails] = useState({});   // advOrderNo -> full order detail
  const rowsRef = useRef([]);
  const dupSeen = useRef(new Set());
  const fetchingRef = useRef(new Set());

  useEffect(() => subscribeQueue(() => tick(t => t + 1)), []);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const items = getQueue();          // every RUNNING order, action-first order
  const meta = getQueueMeta();
  const nActionable = getActionableCount();
  // Index of the first row that needs no action — used to draw one divider
  // between "do this now" and "just running", without reordering anything.
  const waitingFrom = items.findIndex(o => !actionFor(o));

  // Fetch each queued order's detail ONCE and keep it, so every row carries
  // what you need to decide — opening a modal per order defeats the point.
  useEffect(() => {
    // EVERY running row, not just the actionable ones. The duplicate-KYC alert
    // needs realName, which only the detail endpoint returns — scoping this to
    // actionable rows made a repeat buyer invisible until they had already paid,
    // which is the latest possible moment to find out.
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

  // Buyer-log name index — owned by the shared poller so it stays fresh on every
  // page, not just while this one is open.
  const nameIdx = getNameIndex();

  useEffect(() => { if (cursor >= items.length) setCursor(Math.max(0, items.length - 1)); }, [items.length, cursor]);

  // Stable colour per merchant, assigned by position in the merchant list, so
  // "which account is this?" is answerable at a glance instead of by reading.
  const merchantTone = useCallback((mid) => {
    const i = (meta.merchants || []).findIndex(m => m.id === mid);
    return MERCHANT_TONES[(i < 0 ? 0 : i) % MERCHANT_TONES.length];
  }, [meta.merchants]);

  // Duplicate-KYC alert. Gated on that merchant's "Catat buyer & alert nama"
  // switch, and fired once per order — a repeat buyer sitting in the queue for
  // ten minutes must not sound every poll.
  useEffect(() => {
    items.forEach(o => {
      if (!isBuyerLogOn(o.merchantId)) return;
      const rn = details[o.advOrderNo]?.userInfo?.realName;
      if (!rn) return;
      const times = (nameIdx[normName(rn)] || []).filter(n => n !== o.advOrderNo).length;
      if (times < 1 || dupSeen.current.has(o.advOrderNo)) return;
      dupSeen.current.add(o.advOrderNo);
      announceDuplicate({ merchantId: o.merchantId, advOrderNo: o.advOrderNo, realName: rn, times: times + 1 });
    });
  }, [items, details, nameIdx]);

  const act = useCallback(async (order) => {
    if (!order || busy) return;
    setBusy(order.advOrderNo);
    try {
      const ok = await runAction(order.merchantId, order);
      if (ok) {
        // runAction already broadcast 'p2p:action-done': the queue applied the
        // change locally (release → row gone, confirm → flips to waiting) and
        // kicked a refresh. The flash just needs clearing.
        setDoneFlash(order.advOrderNo);
        setTimeout(() => setDoneFlash(null), 900);
      }
    } finally { setBusy(null); }
  }, [busy]);

  const copy = (v, label) => copyToClipboard(v, label); // works on http:// too, always toasts

  useEffect(() => {
    const onKey = (e) => {
      if (detailOrder) return;
      if (document.querySelector('[data-confirm-open]')) return; // the dialog owns the keyboard
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const k = e.key.toLowerCase();
      if (k === '?') { setShowKeys(s => !s); return; }
      if (k === 'escape') { setShowKeys(false); return; }
      if (items.length === 0) return;
      if (k === 's' || e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(items.length - 1, c + 1)); }
      else if (k === 'w' || e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
      else if (k === 'r' && actionFor(items[cursor]) === 'release') { e.preventDefault(); act(items[cursor]); }
      else if (k === 'c' && actionFor(items[cursor]) === 'confirm') { e.preventDefault(); act(items[cursor]); }
      else if (e.key === 'Enter' && actionFor(items[cursor])) { e.preventDefault(); act(items[cursor]); }
      else if (k === 'd') { e.preventDefault(); setDetailOrder(items[cursor]); }
      else if (k === 'g') { e.preventDefault(); refreshQueue({ force: true }); }
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
          <span className={`text-xs rounded-md px-2 py-0.5 font-semibold ${nActionable ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-800 text-surface-300'}`}
            title="Perlu aksi sekarang">
            {nActionable}
          </span>
          {items.length > nActionable && (
            <span className="text-xs rounded-md px-2 py-0.5 bg-surface-800 text-surface-300"
              title="Order berjalan yang belum perlu aksi">
              +{items.length - nActionable} jalan
            </span>
          )}
          <span className="hidden sm:inline text-xs text-surface-300 truncate">
            {meta.merchants.length} merchant{meta.lastError ? ' · sebagian gagal dimuat' : ''}
          </span>
          <div className="flex-1" />
          <button onClick={() => setShowKeys(s => !s)} title="Pintasan keyboard (?)"
            className="hidden md:flex w-8 h-8 items-center justify-center text-surface-300 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-lg transition-colors">
            <Keyboard size={14} />
          </button>
          <button onClick={() => refreshQueue({ force: true })} title="Refresh (G) — langsung ke bursa, tanpa cache"
            className="w-8 h-8 flex items-center justify-center text-surface-200 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-lg transition-colors">
            <RefreshCw size={14} className={meta.inFlight ? 'animate-spin text-brand-300' : ''} />
          </button>
        </header>

        {showKeys && (
          <div className="hidden md:flex flex-wrap gap-x-5 gap-y-1 px-4 py-2 border-b border-surface-700 bg-surface-900 text-[11px] text-surface-300">
            {[['W / ↑', 'naik'], ['S / ↓', 'turun'], ['R', 'release'], ['C', 'konfirmasi bayar'], ['Enter', 'jalankan aksi'], ['Enter / Esc', 'ya / batal di dialog'], ['D', 'buka chat'], ['G', 'refresh'], ['?', 'tutup bantuan']].map(([k, d]) => (
              <span key={k}><kbd className="font-mono text-surface-100 bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5">{k}</kbd> {d}</span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2 sm:space-y-2.5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-buy/10 border border-buy/25 flex items-center justify-center mb-1">
                <CheckCircle2 size={24} className="text-buy" />
              </div>
              <p className="text-surface-50 font-medium">Tidak ada order berjalan</p>
              <p className="text-sm text-surface-300 max-w-xs">Semua order sudah selesai. Order yang sudah kelar tidak ditampilkan di sini.</p>
            </div>
          ) : items.map((o, i) => {
            const kind = actionFor(o);
            const waiting = !kind;
            const tone = merchantTone(o.merchantId);
            const d = details[o.advOrderNo];
            const remaining = o.payTimeLimit ? o.payTimeLimit - now : 0;
            const cd = fmtRemaining(remaining);
            const urgent = cd && remaining < 5 * 60 * 1000;
            const isBusy = busy === o.advOrderNo;
            const flashed = doneFlash === o.advOrderNo;
            const selected = i === cursor;

            const realName = d?.userInfo?.realName || null;
            const pay = d?.confirmPaymentInfo || d?.paymentInfo?.[0] || null;
            // Only when that merchant has "Catat buyer & alert nama" switched on.
            const priorCount = (realName && isBuyerLogOn(o.merchantId))
              ? (nameIdx[normName(realName)] || []).filter(n => n !== o.advOrderNo).length
              : 0;

            return (
              <div key={o.advOrderNo}>
              {i === waitingFrom && waitingFrom > 0 && (
                <div className="flex items-center gap-2 pt-3 pb-1">
                  <span className="h-px flex-1 bg-surface-700" />
                  <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-surface-300">
                    <Hourglass size={11} /> Berjalan — belum perlu aksi Anda
                  </span>
                  <span className="h-px flex-1 bg-surface-700" />
                </div>
              )}
              <div ref={el => rowsRef.current[i] = el}
                onMouseEnter={() => setCursor(i)}
                className={`relative overflow-hidden rounded-xl border transition-all ${waiting ? 'opacity-[0.78] hover:opacity-100 ' : ''}${
                  flashed ? 'bg-buy/15 border-buy/50'
                  : priorCount > 0 ? 'bg-sell/[0.07] border-sell/45'
                  : selected ? 'bg-surface-900 border-brand-500/45 shadow-lift'
                  : 'bg-surface-900/50 border-surface-700 hover:border-surface-600'}`}>
                {/* Merchant spine — same colour as the chip, so the account is
                    identifiable from the edge of the card alone. */}
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${tone.bar} ${waiting ? 'opacity-50' : ''}`} />
                <div className="pl-4 pr-3 sm:pl-5 sm:pr-4 py-3">

                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {/* Which exchange this order lives on — the one thing that
                            must never be ambiguous when two platforms share a queue. */}
                        <PlatformBadge platform={platformOf(o)} />
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-0.5 ring-1 ${tone.chip}`}
                          title={`Merchant: ${o.merchantName}`}>
                          <Store size={10} /> {o.merchantName}
                        </span>
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

                      <p className={`font-mono font-semibold tnum leading-none text-surface-50 ${waiting ? 'text-lg sm:text-xl' : 'text-2xl sm:text-3xl'}`}>
                        {formatAmount(o.amount, 0)}
                        <span className="text-xs text-surface-300 font-sans font-normal ml-1.5">{o.fiatUnit}</span>
                        <button onClick={() => copy(String(Math.round(parseFloat(o.amount) || 0)), 'Nominal')} title="Salin nominal (angka bulat, tanpa desimal)"
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

                    {waiting ? (
                      // No button at all — a disabled one invites clicking and
                      // then explaining why nothing happened.
                      <div className="flex-shrink-0 flex items-center justify-center gap-1.5 text-xs text-surface-300 rounded-lg px-3 sm:px-4 h-11 min-w-[104px] sm:min-w-[132px] border border-dashed border-surface-700 text-center leading-tight">
                        <Hourglass size={13} className="flex-shrink-0" />
                        {o._state === 9 ? 'Banding — tangani di BingX' : o._state === 10 ? `Status BingX ${o._bingx?.orderStatus ?? '?'} — buka Raw` : o.side === 'SELL' ? 'Menunggu pembeli bayar' : 'Menunggu penjual release'}
                      </div>
                    ) : (
                      <button onClick={() => act(o)} disabled={!!busy}
                        className={`flex-shrink-0 flex items-center justify-center gap-1.5 text-sm font-medium rounded-lg px-3 sm:px-4 h-11 min-w-[104px] sm:min-w-[132px] transition-all disabled:opacity-40 ${
                          kind === 'release'
                            ? 'bg-buy/15 text-buy border border-buy/30 hover:bg-buy/25 hover:shadow-glow-buy'
                            : 'bg-brand-500/15 text-brand-300 border border-brand-500/30 hover:bg-brand-500/25 hover:shadow-glow-sm'}`}>
                        {isBusy ? <RefreshCw size={15} className="animate-spin" />
                          : kind === 'release' ? <><Coins size={15} /> Release</>
                          : <><CheckCircle2 size={15} /> Konfirmasi</>}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mt-3 pt-2.5 border-t border-surface-700/50">
                    <Field label="Jumlah" value={`${formatAmount(o.tradableQuantity, 2)} USDT`} mono />
                    <Field label="Harga/USDT" value={d ? `${formatAmount(d.price, 0)} ${o.fiatUnit}` : null} mono />
                    <Field label="Dibuat" value={formatTime(o.createTime)} mono />
                    <Field label="KYC" value={d ? (platformOf(o) === 'bingx' ? (d.userInfo?.realName ? 'Terverifikasi' : '—') : (KYC[d.userInfo?.kycLevel] || `Level ${d.userInfo?.kycLevel ?? '?'}`)) : null} />
                  </div>

                  <button onClick={() => setDetailOrder(o)}
                    className={`mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg px-3 h-9 border transition-colors ${
                      o.unreadCount > 0
                        ? 'bg-sell/15 text-sell border-sell/40 hover:bg-sell/25'
                        : 'bg-surface-800 text-surface-100 border-surface-600 hover:bg-surface-700 hover:border-surface-500'}`}>
                    <MessageSquare size={13} />
                    {o.unreadCount > 0 ? `Chat · ${o.unreadCount} pesan baru` : 'Buka chat'}
                  </button>
                </div>
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

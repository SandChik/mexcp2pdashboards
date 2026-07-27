import { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '../components/Layout';
import OrderDetailModal from '../components/OrderDetailModal';
import { formatAmount, getBankName, SideBadge, OrderStateBadge } from '../components/helpers';
import { runAction, actionFor } from '../actions';
import { getQueue, subscribeQueue, refreshQueue, removeFromQueue, getQueueMeta } from '../actionQueue';
import { Zap, RefreshCw, Keyboard, CheckCircle2, Coins, AlertTriangle, Clock, ExternalLink } from 'lucide-react';

function fmtRemaining(ms) {
  if (!ms || ms <= 0) return null;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export default function ActionQueue() {
  const [, tick] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(null);          // advOrderNo currently being acted on
  const [doneFlash, setDoneFlash] = useState(null); // advOrderNo that just succeeded
  const [cursor, setCursor] = useState(0);          // keyboard selection
  const [detailOrder, setDetailOrder] = useState(null);
  const [showKeys, setShowKeys] = useState(false);
  const rowsRef = useRef([]);

  useEffect(() => subscribeQueue(() => tick(t => t + 1)), []);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const items = getQueue();
  const meta = getQueueMeta();

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

  // ── Keyboard shortcuts (desktop) ────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (detailOrder) return; // modal owns the keyboard
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

  return (
    <Layout>
      <div className="h-[100dvh] flex flex-col bg-surface-950 overflow-hidden">

        <header className="glass border-b flex items-center gap-2 px-3 sm:px-4 h-14 flex-shrink-0">
          <Zap size={17} className="text-brand-300 flex-shrink-0" />
          <h1 className="font-display font-semibold text-surface-50 text-[15px]">Butuh aksi</h1>
          <span className={`text-xs rounded-md px-2 py-0.5 font-semibold ${items.length ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-800 text-surface-300'}`}>
            {items.length}
          </span>
          <span className="hidden sm:inline text-xs text-surface-300 truncate">
            gabungan {meta.merchants.length} merchant{meta.lastError ? ' · sebagian gagal dimuat' : ''}
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
            {[['J / ↓', 'turun'], ['K / ↑', 'naik'], ['R', 'release'], ['C', 'konfirmasi bayar'], ['Enter', 'jalankan aksi baris ini'], ['D', 'buka detail'], ['G', 'refresh'], ['?', 'tutup bantuan']].map(([k, d]) => (
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
            const remaining = o.payTimeLimit ? o.payTimeLimit - now : 0;
            const cd = fmtRemaining(remaining);
            const urgent = cd && remaining < 5 * 60 * 1000;
            const isBusy = busy === o.advOrderNo;
            const flashed = doneFlash === o.advOrderNo;
            const selected = i === cursor;

            return (
              <div key={o.advOrderNo} ref={el => rowsRef.current[i] = el}
                onMouseEnter={() => setCursor(i)}
                className={`border-b border-surface-700/60 border-l-2 transition-colors ${
                  flashed ? 'bg-buy/15 border-l-buy'
                  : selected ? 'bg-surface-900/70 border-l-brand-400'
                  : 'border-l-transparent hover:bg-surface-900/40'}`}>
                <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3">

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[11px] text-surface-300 font-medium">{o.merchantName}</span>
                      <SideBadge side={o.side} />
                      <OrderStateBadge state={o._state} />
                      {cd && (
                        <span className={`flex items-center gap-0.5 text-[11px] font-mono tnum rounded-md px-1.5 py-0.5 ${urgent ? 'bg-sell/15 text-sell animate-pulse-ring' : 'bg-warning/10 text-warning'}`}>
                          {urgent ? <AlertTriangle size={10} /> : <Clock size={10} />}{cd}
                        </span>
                      )}
                    </div>

                    {/* Amount is the hero: this is the number you match against
                        your bank notification before releasing. */}
                    <p className="text-2xl sm:text-3xl font-mono font-semibold tnum leading-none text-surface-50">
                      {formatAmount(o.amount, 0)}
                      <span className="text-xs text-surface-300 font-sans font-normal ml-1.5">{o.fiatUnit}</span>
                    </p>

                    <p className="text-xs text-surface-300 mt-1 truncate">
                      {formatAmount(o.tradableQuantity, 2)} USDT · {o.userInfo?.nickName || 'Unknown'}
                      {o.payMethod ? ` · ${getBankName(o.payMethod)}` : ''}
                    </p>
                    <button onClick={() => setDetailOrder(o)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-surface-300 hover:text-brand-300 transition-colors">
                      <ExternalLink size={11} /> Detail & chat
                    </button>
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
              </div>
            );
          })}
        </div>
      </div>

      {detailOrder && (
        <OrderDetailModal merchantId={detailOrder.merchantId} advOrderNo={detailOrder.advOrderNo}
          onClose={() => { setDetailOrder(null); refreshQueue(); }}
          onActionDone={() => refreshQueue()} />
      )}
    </Layout>
  );
}

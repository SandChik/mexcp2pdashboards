import { useState, useEffect, useCallback, useRef } from 'react';
import { merchantApi } from '../api';
import BingxPanel from '../components/BingxPanel';
import Layout from '../components/Layout';
import { PlatformBadge } from '../components/helpers';
import { Plus, RefreshCw, Calendar, Radio, CalendarRange, X } from 'lucide-react';
import { subscribeQueue, getActiveByMerchant } from '../actionQueue';
import { useNavigate } from 'react-router-dom';

/**
 * BingX dashboard — the page below "Dashboard MEXC" in the menu.
 *
 * Same skeleton as Dashboard.jsx (one set of panels mounted, JS breakpoint,
 * mobile switcher, the same date filter: presets + custom range ≤ 8 days) with
 * one difference: the event week. MEXC's event runs Friday→Friday; BingX's
 * runs Monday→Sunday, so the preset here starts on the most recent Monday
 * and there is a second one for the week that just ended.
 * BingX has no server-side date filter: the backend pages newest→oldest
 * through history (up to 2,000 orders for ranges over 3 days) and clips.
 * Orders from here ALSO flow into the shared Antrian page, tagged BingX.
 */
function useIsDesktop() {
  const q = '(min-width: 1024px)';
  const [is, setIs] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const onChange = e => setIs(e.matches);
    setIs(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return is;
}

const DAY = 86400000;
const MAX_DAYS = 8;
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const todayStart = () => startOfDay(Date.now());
const toDateStr = (ts) => new Date(ts).toISOString().slice(0, 10);

// Most recent Monday 00:00 that is <= now (today if today is Monday).
function lastMondayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - 1 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export default function BingxDashboard() {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(() => ({ startTime: todayStart(), endTime: Date.now(), kind: 'today' }));
  const [showDate, setShowDate] = useState(false);
  const [dateInput, setDateInput] = useState(() => ({ from: toDateStr(todayStart()), to: toDateStr(Date.now()) }));
  const dateRef = useRef(null);
  const sheetRef = useRef(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeMerchant, setActiveMerchant] = useState(0);
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();

  const [, tickQ] = useState(0);
  useEffect(() => subscribeQueue(() => tickQ(t => t + 1)), []);
  const activeCounts = getActiveByMerchant();

  const load = useCallback(async () => {
    try { const r = await merchantApi.list(); setMerchants((r.data || []).filter(m => m.platform === 'bingx')); }
    catch { /* interceptor handles 401 */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e) => {
      if (dateRef.current?.contains(e.target)) return;
      if (sheetRef.current?.contains(e.target)) return;
      setShowDate(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setShowDate(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);

  function setPreset(kind) {
    const now = Date.now();
    if (kind === 'today') setDateRange({ startTime: todayStart(), endTime: now, kind });
    else if (kind === 'event') setDateRange({ startTime: lastMondayStart(), endTime: now, kind });
    else if (kind === 'lastEvent') {
      const thisMon = lastMondayStart();
      setDateRange({ startTime: thisMon - 7 * DAY, endTime: thisMon - 1, kind });
    }
    else setDateRange({ startTime: now - kind * DAY, endTime: now, kind: `${kind}d` });
    setShowDate(false);
  }
  function applyCustom() {
    const from = new Date(dateInput.from + 'T00:00:00').getTime();
    const to = new Date(dateInput.to + 'T23:59:59').getTime();
    if (isNaN(from) || isNaN(to) || to <= from || to - from > MAX_DAYS * DAY) return;
    setDateRange({ startTime: from, endTime: to, kind: 'custom' });
    setShowDate(false);
  }
  const customInvalid = (() => {
    const from = new Date(dateInput.from + 'T00:00:00').getTime();
    const to = new Date(dateInput.to + 'T23:59:59').getTime();
    if (isNaN(from) || isNaN(to)) return null;
    if (to <= from) return 'Tanggal akhir harus setelah tanggal mulai';
    if (to - from > MAX_DAYS * DAY) return `Rentang maksimal ${MAX_DAYS} hari`;
    return null;
  })();
  const fmtD = (ts) => new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  const rangeLabel = (() => {
    if (dateRange.kind === 'today') return 'Hari ini';
    if (dateRange.kind === 'event') return `Event (Sen ${fmtD(dateRange.startTime)} → now)`;
    if (dateRange.kind === 'lastEvent') return `Event lalu (${fmtD(dateRange.startTime)} – ${fmtD(dateRange.endTime)})`;
    if (dateRange.kind === '3d') return '3 hari';
    if (dateRange.kind === '7d') return '7 hari';
    return `${fmtD(dateRange.startTime)} – ${fmtD(dateRange.endTime)}`;
  })();

  const datePanel = (
    <div className="w-full sm:w-64 bg-surface-800 border border-surface-700 rounded-xl p-3 shadow-lift">
      <button onClick={() => setPreset('event')}
        className="w-full flex items-center gap-2 text-xs text-brand-300 hover:bg-brand-500/10 border border-brand-500/30 rounded-lg px-2.5 py-2.5 mb-1.5 transition-colors">
        <CalendarRange size={14} /> Event minggu ini — Senin → sekarang
      </button>
      <button onClick={() => setPreset('lastEvent')}
        className="w-full flex items-center gap-2 text-xs text-surface-200 hover:bg-surface-700 border border-surface-700 rounded-lg px-2.5 py-2.5 mb-2 transition-colors">
        <CalendarRange size={14} /> Event minggu lalu — Senin s/d Minggu
      </button>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {[['Hari ini', 'today'], ['3 hari', 3], ['7 hari', 7]].map(([l, k]) => (
          <button key={l} onClick={() => setPreset(k)}
            className="text-xs text-surface-200 hover:text-surface-50 bg-surface-900 hover:bg-surface-700 border border-surface-700 rounded-lg px-2 py-2 transition-colors">{l}</button>
        ))}
      </div>
      <p className="text-xs text-surface-300 mb-2">Rentang khusus (maks {MAX_DAYS} hari)</p>
      <div className="grid grid-cols-2 gap-2">
        {[['Dari', 'from'], ['Sampai', 'to']].map(([lbl, k]) => (
          <div key={k}>
            <label className="text-[11px] text-surface-300 block mb-1">{lbl}</label>
            <input type="date" value={dateInput[k]} onChange={e => setDateInput(p => ({ ...p, [k]: e.target.value }))}
              className="w-full bg-surface-900 border border-surface-700 rounded-lg px-2 py-1.5 text-xs text-surface-50 font-mono focus:outline-none focus:border-brand-500" />
          </div>
        ))}
      </div>
      {customInvalid && <p className="text-xs text-sell mt-2">{customInvalid}</p>}
      <button onClick={applyCustom} disabled={!!customInvalid}
        className="btn-primary w-full mt-3 !h-9 !text-xs">Terapkan rentang</button>
      <p className="text-[11px] text-surface-300/80 mt-2">Rentang &gt; 3 hari membaca sampai 2.000 order dari BingX — muat ±10 detik.</p>
    </div>
  );

  if (loading) return (
    <Layout>
      <div className="h-[100dvh] flex flex-col bg-surface-950 p-3 gap-3">
        <div className="skeleton h-12 w-full" />
        <div className="grid gap-3 flex-1 grid-cols-1 lg:grid-cols-2">
          {[0, 1].map(i => <div key={i} className="skeleton h-full min-h-[200px]" />)}
        </div>
      </div>
    </Layout>
  );

  const shown = merchants.slice(0, 2);

  return (
    <Layout>
      <div className="h-[100dvh] flex flex-col bg-surface-950">
        <header className="glass border-b flex-shrink-0 z-30">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 h-14">
            <div className="flex items-center gap-2 min-w-0">
              <img src="/brand/sandchik-mark.png" alt="SandChik" className="w-7 h-7 rounded-md bg-[#f6f3ee] flex-shrink-0" />
              <h1 className="font-display font-semibold text-surface-50 text-[15px] tracking-tight truncate">SandChik P2P</h1>
              <img src="/brand/bingx.png" alt="BingX" className="w-5 h-5 rounded-md bg-white flex-shrink-0" title="Dashboard BingX" />
              <span className="hidden xs:inline text-xs text-surface-300 flex-shrink-0">{merchants.length} merchant</span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* Date — desktop popover, mobile bottom sheet (same as the MEXC dashboard) */}
              <div className="relative" ref={dateRef}>
                <button onClick={() => setShowDate(s => !s)} aria-expanded={showDate}
                  className="btn-ghost !px-2.5 !h-8 !text-xs max-w-[170px]">
                  <Calendar size={13} className="flex-shrink-0" />
                  <span className="truncate">{rangeLabel}</span>
                </button>
                {showDate && <div className="hidden sm:block absolute right-0 top-10 z-40">{datePanel}</div>}
              </div>

              <button onClick={() => setAutoRefresh(a => !a)}
                title="Auto-refresh data tiap 5 detik"
                className={`flex items-center gap-1.5 text-xs rounded-lg px-2 sm:px-2.5 h-8 border transition-all ${
                  autoRefresh ? 'text-buy border-buy/30 bg-buy/10 shadow-glow-buy' : 'text-surface-300 border-surface-700 hover:bg-surface-800'}`}>
                <Radio size={13} className={autoRefresh ? 'animate-pulse' : ''} />
                <span className="hidden sm:inline">{autoRefresh ? 'Auto' : 'Manual'}</span>
              </button>

              <button onClick={() => setRefreshKey(k => k + 1)} title="Refresh semua panel"
                className="w-8 h-8 flex items-center justify-center text-surface-200 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-lg transition-colors">
                <RefreshCw size={14} />
              </button>

              <button onClick={() => navigate('/settings')} title="Tambah merchant BingX"
                className="btn-primary !h-8 !px-2.5 sm:!px-3 !text-xs">
                <Plus size={14} /><span className="hidden sm:inline">Merchant</span>
              </button>
            </div>
          </div>

          {shown.length > 1 && (
            <div className="lg:hidden flex gap-1.5 px-3 pb-2 overflow-x-auto no-scrollbar">
              {shown.map((m, i) => {
                const n = activeCounts[m.id] ?? 0;
                return (
                  <button key={m.id} onClick={() => setActiveMerchant(i)}
                    className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 border transition-all ${
                      activeMerchant === i ? 'bg-brand-500/15 text-brand-300 border-brand-500/40 shadow-glow-sm'
                        : n > 0 ? 'text-surface-100 border-brand-500/30' : 'text-surface-300 border-surface-700'}`}>
                    {m.name}
                    {n > 0 && <span className="bg-brand-500 text-white text-[10px] font-semibold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">{n}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {showDate && (
          <div className="sm:hidden fixed inset-0 z-50 flex items-end animate-fade-in" onClick={() => setShowDate(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div ref={sheetRef} className="relative w-full p-3 pb-safe animate-sheet-up" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-sm font-medium text-surface-50">Pilih rentang</span>
                <button onClick={() => setShowDate(false)} className="text-surface-300 hover:text-surface-50 p-1"><X size={18} /></button>
              </div>
              {datePanel}
            </div>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white border border-warning/30 flex items-center justify-center mb-1 overflow-hidden">
              <img src="/brand/bingx.png" alt="BingX" className="w-12 h-12" />
            </div>
            <p className="text-surface-50 font-medium flex items-center gap-2">Belum ada merchant <PlatformBadge platform="bingx" /></p>
            <p className="text-sm text-surface-300 max-w-xs">Tambahkan akun merchant BingX di Settings (pilih platform BingX), lalu jalankan "Tes koneksi" di sana sebelum mengandalkan panel ini.</p>
            <button onClick={() => navigate('/settings')} className="btn-primary mt-1">Buka Settings</button>
          </div>
        ) : isDesktop ? (
          <div className="grid flex-1 gap-3 p-3 overflow-hidden min-h-0"
            style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
            {shown.map(m => (
              <BingxPanel key={m.id} merchant={m} dateRange={dateRange} refreshKey={refreshKey} autoRefresh={autoRefresh} />
            ))}
          </div>
        ) : (
          <div className="flex-1 min-h-0 p-2.5">
            {shown.map((m, i) => (
              <div key={m.id} className={i === activeMerchant ? 'h-full' : 'hidden'}>
                <BingxPanel merchant={m} dateRange={dateRange} refreshKey={refreshKey} autoRefresh={autoRefresh} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

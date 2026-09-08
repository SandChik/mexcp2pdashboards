import { useState, useEffect, useCallback, useRef } from 'react';
import { merchantApi } from '../api';
import BingxPanel from '../components/BingxPanel';
import Layout from '../components/Layout';
import { PlatformBadge } from '../components/helpers';
import { Plus, RefreshCw, Calendar, Radio, Hexagon } from 'lucide-react';
import { subscribeQueue, getActiveByMerchant } from '../actionQueue';
import { useNavigate } from 'react-router-dom';

/**
 * BingX dashboard — the page below "Dashboard MEXC" in the menu.
 *
 * Same skeleton as Dashboard.jsx (one set of panels mounted, JS breakpoint,
 * mobile switcher) with two simplifications: at most 2 merchants, and the
 * date presets only (BingX has no server-side date filter; the backend pages
 * through recent history and clips it, so long custom ranges buy nothing).
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
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const todayStart = () => startOfDay(Date.now());

export default function BingxDashboard() {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(() => ({ startTime: todayStart(), endTime: Date.now(), kind: 'today' }));
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

  const presets = [['Hari ini', 'today'], ['3 hari', 3], ['7 hari', 7]];
  function setPreset(kind) {
    const now = Date.now();
    if (kind === 'today') setDateRange({ startTime: todayStart(), endTime: now, kind });
    else setDateRange({ startTime: now - kind * DAY, endTime: now, kind: `${kind}d` });
  }
  const isPreset = (kind) => dateRange.kind === (kind === 'today' ? 'today' : `${kind}d`);

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
              <Hexagon size={16} className="text-warning flex-shrink-0" />
              <h1 className="font-display font-semibold text-surface-50 text-[15px] tracking-tight truncate">Dashboard BingX</h1>
              <span className="hidden xs:inline text-xs text-surface-300 flex-shrink-0">{merchants.length} merchant</span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <div className="flex items-center gap-1 border border-surface-700 rounded-lg p-0.5">
                <Calendar size={13} className="text-surface-300 ml-1.5 hidden sm:block" />
                {presets.map(([l, k]) => (
                  <button key={l} onClick={() => setPreset(k)}
                    className={`text-xs rounded-md px-2 h-7 transition-colors ${isPreset(k) ? 'bg-brand-500/15 text-brand-300' : 'text-surface-300 hover:text-surface-50'}`}>{l}</button>
                ))}
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

        {shown.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-warning/10 border border-warning/30 flex items-center justify-center mb-1">
              <Hexagon size={22} className="text-warning" />
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

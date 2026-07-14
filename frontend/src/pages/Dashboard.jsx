import { useState, useEffect, useCallback, useRef } from 'react';
import { merchantApi } from '../api';
import MerchantPanel from '../components/MerchantPanel';
import Layout from '../components/Layout';
import { Plus, RefreshCw, Calendar, Radio, CalendarRange } from 'lucide-react';
import NotificationBell from '../components/NotificationBell';
import { useNavigate } from 'react-router-dom';

const DAY = 86400000;
const MAX_DAYS = 8;
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const todayStart = () => startOfDay(Date.now());
const toDateStr = (ts) => new Date(ts).toISOString().slice(0, 10);

// Most recent Friday 00:00 that is <= now (today if today is Friday).
function lastFridayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - 5 + 7) % 7; // 0=Sun..6=Sat, Friday=5
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export default function Dashboard() {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(() => ({ startTime: todayStart(), endTime: Date.now(), kind: 'today' }));
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showDate, setShowDate] = useState(false);
  const [dateInput, setDateInput] = useState(() => ({ from: toDateStr(todayStart()), to: toDateStr(Date.now()) }));
  const navigate = useNavigate();
  const dateRef = useRef(null);

  const load = useCallback(async () => {
    try { const r = await merchantApi.list(); setMerchants(r.data); }
    catch { /* interceptor handles 401 */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e) => { if (dateRef.current && !dateRef.current.contains(e.target)) setShowDate(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function setPreset(kind) {
    const now = Date.now();
    if (kind === 'today') setDateRange({ startTime: todayStart(), endTime: now, kind });
    else if (kind === 'event') setDateRange({ startTime: lastFridayStart(), endTime: now, kind });
    else setDateRange({ startTime: now - kind * DAY, endTime: now, kind: `${kind}d` });
    setShowDate(false);
  }
  function applyCustom() {
    const from = new Date(dateInput.from + 'T00:00:00').getTime();
    const to = new Date(dateInput.to + 'T23:59:59').getTime();
    if (isNaN(from) || isNaN(to)) return;
    if (to <= from) return;
    if (to - from > MAX_DAYS * DAY) return; // backend window cap
    setDateRange({ startTime: from, endTime: to, kind: 'custom' });
    setShowDate(false);
  }
  const customInvalid = (() => {
    const from = new Date(dateInput.from + 'T00:00:00').getTime();
    const to = new Date(dateInput.to + 'T23:59:59').getTime();
    if (isNaN(from) || isNaN(to)) return null;
    if (to <= from) return 'End must be after start';
    if (to - from > MAX_DAYS * DAY) return `Range can't exceed ${MAX_DAYS} days`;
    return null;
  })();

  const rangeLabel = (() => {
    if (dateRange.kind === 'today') return 'Today';
    if (dateRange.kind === 'event') return 'Event week (Fri→now)';
    if (dateRange.kind === '3d') return 'Last 3 days';
    if (dateRange.kind === '7d') return 'Last 7 days';
    const f = new Date(dateRange.startTime), t = new Date(dateRange.endTime);
    return `${f.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – ${t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`;
  })();

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-surface-950">
      <RefreshCw size={20} className="text-brand-500 animate-spin" />
    </div>
  );

  return (
    <Layout>
      <div className="h-screen flex flex-col bg-surface-950">

        {/* Top bar */}
        <header className="flex items-center justify-between px-4 h-14 border-b border-surface-700 flex-shrink-0">
          <div className="flex items-baseline gap-3">
            <h1 className="font-semibold text-surface-50 text-[15px] tracking-tight">P2P Dashboard</h1>
            <span className="text-xs text-surface-300">{merchants.length} {merchants.length === 1 ? 'merchant' : 'merchants'}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={dateRef}>
              <button onClick={() => setShowDate(s => !s)}
                className="flex items-center gap-1.5 text-xs text-surface-200 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-md px-2.5 h-8 transition-colors">
                <Calendar size={13} /> {rangeLabel}
              </button>
              {showDate && (
                <div className="absolute right-0 top-10 z-30 w-60 bg-surface-800 border border-surface-700 rounded-lg p-3 shadow-xl shadow-black/40">
                  <button onClick={() => setPreset('event')}
                    className="w-full flex items-center gap-2 text-xs text-brand-400 hover:bg-brand-500/10 border border-brand-500/30 rounded-md px-2.5 py-2 mb-2 transition-colors">
                    <CalendarRange size={14} /> Event week — Friday → now
                  </button>
                  <div className="grid grid-cols-3 gap-1 mb-3">
                    {[['Today', 'today'], ['3 days', 3], ['7 days', 7]].map(([l, k]) => (
                      <button key={l} onClick={() => setPreset(k)}
                        className="text-xs text-surface-200 hover:text-surface-50 bg-surface-900 hover:bg-surface-700 border border-surface-700 rounded px-2 py-1.5 transition-colors">{l}</button>
                    ))}
                  </div>
                  <p className="text-xs text-surface-300 mb-2">Custom range (max {MAX_DAYS} days)</p>
                  {[['From', 'from'], ['To', 'to']].map(([lbl, k]) => (
                    <div key={k} className="mb-2">
                      <label className="text-xs text-surface-300 block mb-1">{lbl}</label>
                      <input type="date" value={dateInput[k]} onChange={e => setDateInput(p => ({ ...p, [k]: e.target.value }))}
                        className="w-full bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-surface-50 font-mono focus:outline-none focus:border-brand-500" />
                    </div>
                  ))}
                  {customInvalid && <p className="text-xs text-sell mb-2">{customInvalid}</p>}
                  <button onClick={applyCustom} disabled={!!customInvalid}
                    className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-xs rounded py-1.5 transition-colors">Apply range</button>
                </div>
              )}
            </div>
            <NotificationBell />
            <button onClick={() => setAutoRefresh(a => !a)} title="Auto-refresh data every 5s (this does NOT pause trading)"
              className={`flex items-center gap-1.5 text-xs rounded-md px-2.5 h-8 border transition-colors ${
                autoRefresh ? 'text-buy border-buy/30 bg-buy/10' : 'text-surface-300 border-surface-700 hover:bg-surface-800'}`}>
              <Radio size={13} className={autoRefresh ? 'animate-pulse' : ''} />{autoRefresh ? 'Auto' : 'Manual'}
            </button>
            <button onClick={() => setRefreshKey(k => k + 1)} title="Refresh all"
              className="w-8 h-8 flex items-center justify-center text-surface-200 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-md transition-colors">
              <RefreshCw size={14} />
            </button>
            <button onClick={() => navigate('/settings')}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-md px-3 h-8 transition-colors">
              <Plus size={14} /> Add merchant
            </button>
          </div>
        </header>

        {merchants.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-surface-50 font-medium">No merchants yet</p>
            <p className="text-sm text-surface-300">Add a MEXC merchant account to start.</p>
            <button onClick={() => navigate('/settings')}
              className="mt-1 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors">Go to settings</button>
          </div>
        ) : (
          <div className="flex-1 grid gap-3 p-3 overflow-hidden min-h-0"
            style={{ gridTemplateColumns: `repeat(${Math.min(merchants.length, 3)}, minmax(0, 1fr))` }}>
            {merchants.slice(0, 3).map(m => (
              <MerchantPanel key={m.id} merchant={m} dateRange={dateRange}
                refreshKey={refreshKey} autoRefresh={autoRefresh} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

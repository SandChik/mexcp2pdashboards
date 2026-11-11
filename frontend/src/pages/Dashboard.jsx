import { useState, useEffect, useCallback, useRef } from 'react';
import { merchantApi } from '../api';
import MerchantPanel from '../components/MerchantPanel';
import Layout from '../components/Layout';
import DashboardHeader from '../components/DashboardHeader';
import { Plus, CalendarRange } from 'lucide-react';
import { subscribeQueue, getActiveByMerchant } from '../actionQueue';
import { useNavigate } from 'react-router-dom';

/**
 * Breakpoint decided in JS, not CSS.
 *
 * The previous version rendered a mobile block with `lg:hidden` AND a desktop
 * block with `hidden lg:grid`. Tailwind only hides them visually — React mounts
 * BOTH, so every MerchantPanel existed twice at once: two 5-second pollers, two
 * state-change detectors (hence duplicate toasts and sounds) and, before the
 * worker took over, two auto-reply senders inside a single tab.
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

// Most recent Friday 00:00 that is <= now (today if today is Friday).
function lastFridayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - 5 + 7) % 7;
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
  const [activeMerchant, setActiveMerchant] = useState(0); // mobile: which panel is shown
  const [alert, setAlert] = useState(null);   // { index, name, delta } — activity on a panel you can't see
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const dateRef = useRef(null);
  const sheetRef = useRef(null); // mobile bottom sheet lives outside dateRef
  const prevActive = useRef(null);
  const activeMerchantRef = useRef(0);
  useEffect(() => { activeMerchantRef.current = activeMerchant; }, [activeMerchant]);

  // Running-order counts for every merchant, shared with the queue page.
  const [, tickQ] = useState(0);
  useEffect(() => subscribeQueue(() => tickQ(t => t + 1)), []);
  const activeCounts = getActiveByMerchant();

  // When a merchant that is NOT on screen gains a running order, say so — on a
  // phone only one panel is visible, so otherwise you'd have to open each one.
  useEffect(() => {
    if (merchants.length === 0) return;
    const prev = prevActive.current;
    if (prev) {
      merchants.slice(0, 3).forEach((m, i) => {
        const before = prev[m.id] ?? 0, after = activeCounts[m.id] ?? 0;
        if (after > before && i !== activeMerchantRef.current) {
          setAlert({ index: i, name: m.name, delta: after - before });
        }
      });
    }
    prevActive.current = { ...activeCounts };
  }, [activeCounts, merchants]);

  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setAlert(null), 15000);
    return () => clearTimeout(t);
  }, [alert]);

  const load = useCallback(async () => {
    // This page is the MEXC dashboard. BingX merchants have their own page
    // (/bingx); a MerchantPanel would call MEXC endpoints with a BingX key.
    try { const r = await merchantApi.list(); setMerchants((r.data || []).filter(m => (m.platform || 'mexc') === 'mexc')); }
    catch { /* interceptor handles 401 */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e) => {
      // The mobile sheet is a sibling of the trigger button, so checking only
      // dateRef closed it on the very first tap inside it — the filter was
      // unusable on phones. Both containers count as "inside".
      if (dateRef.current?.contains(e.target)) return;
      if (sheetRef.current?.contains(e.target)) return;
      setShowDate(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setShowDate(false); }; // heuristic #3: always an exit
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
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
    if (to - from > MAX_DAYS * DAY) return;
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

  const rangeLabel = (() => {
    if (dateRange.kind === 'today') return 'Hari ini';
    if (dateRange.kind === 'event') return 'Event (Jum→now)';
    if (dateRange.kind === '3d') return '3 hari';
    if (dateRange.kind === '7d') return '7 hari';
    const f = new Date(dateRange.startTime), t = new Date(dateRange.endTime);
    return `${f.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – ${t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`;
  })();

  // Loading: skeletons rather than a lone spinner, so the shape of what's
  // coming is visible immediately (heuristic #1).
  if (loading) return (
    <Layout>
      <div className="page-h flex flex-col bg-surface-950 p-3 gap-3">
        <div className="skeleton h-12 w-full" />
        <div className="grid gap-3 flex-1 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-full min-h-[200px]" />)}
        </div>
      </div>
    </Layout>
  );

  const datePanel = (
    <div className="w-full sm:w-64 bg-surface-800 border border-surface-700 rounded-xl p-3 shadow-lift">
      <button onClick={() => setPreset('event')}
        className="w-full flex items-center gap-2 text-xs text-brand-300 hover:bg-brand-500/10 border border-brand-500/30 rounded-lg px-2.5 py-2.5 mb-2 transition-colors">
        <CalendarRange size={14} /> Event week — Jumat → sekarang
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
    </div>
  );

  return (
    <Layout>
      <div className="page-h flex flex-col bg-surface-950">

        <DashboardHeader
          platform={{ logo: '/brand/mexc.png', label: 'MEXC' }} merchantCount={merchants.length}
          rangeLabel={rangeLabel} showDate={showDate} setShowDate={setShowDate}
          dateRef={dateRef} sheetRef={sheetRef} datePanel={datePanel}
          autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
          onRefresh={() => setRefreshKey(k => k + 1)}
          autoTitle="Auto-refresh data tiap 5 detik (ini TIDAK menghentikan trading)"
          onAdd={() => navigate('/settings')} addTitle="Tambah merchant"
          switcher={{
            items: merchants.slice(0, 3).map(m => ({ id: m.id, name: m.name, count: activeCounts[m.id] ?? 0 })),
            active: activeMerchant,
            onSelect: (i) => { setActiveMerchant(i); if (alert?.index === i) setAlert(null); },
          }}
          alert={alert} onAlertOpen={() => { setActiveMerchant(alert.index); setAlert(null); }} onAlertClose={() => setAlert(null)}
        />

        {/* ── Panels ──────────────────────────────────────────────────── */}
        {merchants.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-grad-brand/20 border border-brand-500/30 flex items-center justify-center mb-1">
              <Plus size={22} className="text-brand-300" />
            </div>
            <p className="text-surface-50 font-medium">Belum ada merchant</p>
            <p className="text-sm text-surface-300 max-w-xs">Tambahkan akun merchant MEXC (API key & secret) untuk mulai memantau order. Akun BingX punya halaman sendiri di menu.</p>
            <button onClick={() => navigate('/settings')} className="btn-primary mt-1">Buka Settings</button>
          </div>
        ) : (
          <>
            {/* Exactly ONE set of panels is ever mounted — see useIsDesktop above. */}
            {isDesktop ? (
              <div className="grid flex-1 gap-3 p-3 overflow-hidden min-h-0"
                style={{ gridTemplateColumns: `repeat(${Math.min(merchants.length, 3)}, minmax(0, 1fr))` }}>
                {merchants.slice(0, 3).map(m => (
                  <MerchantPanel key={m.id} merchant={m} dateRange={dateRange}
                    refreshKey={refreshKey} autoRefresh={autoRefresh} />
                ))}
              </div>
            ) : (
              <div className="flex-1 min-h-0 p-2.5">
                {/* Hidden merchants stay mounted on purpose: that is what keeps
                    their sounds and new-order banner working. Just once each. */}
                {merchants.slice(0, 3).map((m, i) => (
                  <div key={m.id} className={i === activeMerchant ? 'h-full' : 'hidden'}>
                    <MerchantPanel merchant={m} dateRange={dateRange} refreshKey={refreshKey} autoRefresh={autoRefresh} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

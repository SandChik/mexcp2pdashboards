import { useState, useEffect } from 'react';
import { merchantApi, ordersApi } from '../api';
import Layout from '../components/Layout';
import { formatAmount, normalizeState } from '../components/helpers';
import { UserPlus, RefreshCw, CalendarRange, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const DAY = 86400000;
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
function lastFridayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - 5 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}
const toDateStr = (ts) => new Date(ts).toISOString().slice(0, 10);
const fmtDate = (ts) => ts ? new Date(ts).toISOString().slice(0, 10) : '—';

export default function FTDReport() {
  const [merchants, setMerchants] = useState([]);
  const [merchantSel, setMerchantSel] = useState('all');
  const [rangeKind, setRangeKind] = useState('event');
  const [custom, setCustom] = useState({ from: toDateStr(startOfDay()), to: toDateStr(Date.now()) });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => { merchantApi.list().then(r => setMerchants(r.data)).catch(() => {}); }, []);

  function range() {
    const now = Date.now();
    if (rangeKind === 'today') return { startTime: startOfDay(), endTime: now };
    if (rangeKind === 'event') return { startTime: lastFridayStart(), endTime: now };
    if (rangeKind === '7d') return { startTime: now - 7 * DAY, endTime: now };
    const from = new Date(custom.from + 'T00:00:00').getTime();
    const to = new Date(custom.to + 'T23:59:59').getTime();
    return { startTime: from, endTime: to };
  }

  async function calculate() {
    const { startTime, endTime } = range();
    if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) { toast.error('Invalid date range'); return; }
    const targets = merchantSel === 'all' ? merchants : merchants.filter(m => m.id === merchantSel);
    if (targets.length === 0) { toast.error('No merchant selected'); return; }

    setLoading(true); setResult(null);
    const buyers = new Map();
    let totalOrders = 0, capturedOrders = 0;

    try {
      for (const m of targets) {
        setStatus(`Loading orders — ${m.name}...`);
        const r = await ordersApi.market(m.id, { startTime, endTime });
        const raw = r.data;
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        const sellDone = list.filter(o => o.side === 'SELL' && normalizeState(o.state) === 4);
        totalOrders += sellDone.length;
        if (sellDone.length === 0) continue;

        setStatus(`Reading captured stats — ${m.name}...`);
        const snapRes = await ordersApi.ftdStats(m.id);
        const snaps = snapRes.data?.snapshots || {};

        for (const o of sellDone) {
          const snap = snaps[o.advOrderNo];
          const usdt = parseFloat(o.tradableQuantity) || 0;
          if (snap) capturedOrders += 1;
          const memberId = snap?.memberId || null;
          const key = memberId ? 'id:' + memberId : 'nm:' + (snap?.nickName || o.userInfo?.nickName || o.advOrderNo);
          const b = buyers.get(key) || {
            memberId, nickName: snap?.nickName || o.userInfo?.nickName || '—',
            orders: 0, usdt: 0, fiat: 0,
            priorP2P: snap ? snap.priorP2P : null,
            spotCount: snap ? snap.spotCount : null,
            registryTime: snap?.registryTime || null,
            captured: !!snap,
          };
          b.orders += 1; b.usdt += usdt; b.fiat += parseFloat(o.amount) || 0;
          if (snap) {
            b.captured = true;
            b.priorP2P = b.priorP2P === null ? snap.priorP2P : Math.min(b.priorP2P, snap.priorP2P);
            b.spotCount = b.spotCount === null ? snap.spotCount : Math.max(b.spotCount, snap.spotCount);
            if (snap.registryTime) b.registryTime = snap.registryTime;
          }
          buyers.set(key, b);
        }
      }
    } catch (e) {
      toast.error('Failed: ' + (e.response?.data?.error || e.message));
      setLoading(false); setStatus(''); return;
    }

    const rows = [...buyers.values()];
    rows.forEach(b => {
      b.isFtd = b.captured && b.priorP2P === 0;
    });
    rows.sort((a, b) => (b.isFtd - a.isFtd) || ((a.priorP2P ?? 1e9) - (b.priorP2P ?? 1e9)) || b.usdt - a.usdt);
    const ftd = rows.filter(b => b.isFtd);
    setResult({
      totalOrders, capturedOrders,
      uniqueBuyers: rows.length,
      ftdCount: ftd.length,
      ftdUsdt: ftd.reduce((s, b) => s + b.usdt, 0),
      notCaptured: rows.filter(b => !b.captured).length,
      rows,
    });
    setLoading(false); setStatus('');
  }

  const card = 'bg-surface-800 border border-surface-700 rounded-lg p-4';

  return (
    <Layout>
      <div className="h-screen flex flex-col bg-surface-950 overflow-hidden">
        <header className="flex items-center gap-3 px-4 h-14 border-b border-surface-700 flex-shrink-0">
          <UserPlus size={18} className="text-brand-400" />
          <h1 className="font-semibold text-surface-50 text-[15px]">FTD</h1>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className={card}>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-xs text-surface-300 uppercase tracking-wide block mb-1.5">Merchant</label>
                <select value={merchantSel} onChange={e => setMerchantSel(e.target.value)}
                  className="bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-sm text-surface-50 focus:outline-none focus:border-brand-500 min-w-[180px]">
                  <option value="all">All merchants (combined, deduped)</option>
                  {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-surface-300 uppercase tracking-wide block mb-1.5">Range</label>
                <div className="flex gap-1">
                  {[['Event (Fri→now)', 'event'], ['Today', 'today'], ['7 days', '7d'], ['Custom', 'custom']].map(([l, k]) => (
                    <button key={k} onClick={() => setRangeKind(k)}
                      className={`text-xs px-2.5 py-2 rounded-md border transition-colors ${rangeKind === k ? 'bg-brand-500/15 text-brand-400 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700 hover:text-surface-50'}`}>
                      {k === 'event' && <CalendarRange size={12} className="inline mr-1" />}{l}
                    </button>
                  ))}
                </div>
              </div>
              {rangeKind === 'custom' && (
                <div className="flex gap-2">
                  {[['From', 'from'], ['To', 'to']].map(([lbl, key]) => (
                    <div key={key}>
                      <label className="text-xs text-surface-300 uppercase tracking-wide block mb-1.5">{lbl}</label>
                      <input type="date" value={custom[key]} onChange={e => setCustom(p => ({ ...p, [key]: e.target.value }))}
                        className="bg-surface-900 border border-surface-700 rounded-md px-2 py-2 text-sm text-surface-50 font-mono focus:outline-none focus:border-brand-500" />
                    </div>
                  ))}
                </div>
              )}
              <button onClick={calculate} disabled={loading}
                className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium rounded-md px-5 py-2 flex items-center gap-2 transition-colors">
                {loading ? <RefreshCw size={15} className="animate-spin" /> : <UserPlus size={15} />}{loading ? 'Calculating…' : 'Calculate'}
              </button>
            </div>
            {loading && status && <p className="text-xs text-brand-400 mt-2 font-mono">{status}</p>}
          </div>

          {result && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className={card}><p className="text-xs text-surface-300 uppercase tracking-wide">Completed SELL orders</p><p className="text-2xl font-mono font-semibold text-surface-50 mt-1">{result.totalOrders}</p><p className="text-[11px] text-surface-300 mt-0.5">{result.capturedOrders} captured</p></div>
                <div className={card}><p className="text-xs text-surface-300 uppercase tracking-wide">FTD (0 prior P2P)</p><p className="text-2xl font-mono font-semibold text-brand-400 mt-1">{result.ftdCount}</p></div>
                <div className={card}><p className="text-xs text-surface-300 uppercase tracking-wide">FTD volume (USDT)</p><p className="text-2xl font-mono font-semibold text-buy mt-1">{formatAmount(result.ftdUsdt, 2)}</p></div>
              </div>

              {result.notCaptured > 0 && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{result.notCaptured} buyer(s) had no captured stats — their orders completed while the dashboard wasn't capturing, so MEXC no longer exposes their trade count. Keep the dashboard open during the event so in-progress orders get snapshotted.</span>
                </div>
              )}

              <div className={card + ' !p-0 overflow-hidden'}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700 text-center text-xs text-surface-300 uppercase tracking-wide">
                      <th className="px-4 py-2.5 font-medium">#</th>
                      <th className="px-4 py-2.5 font-medium">Nickname</th>
                      <th className="px-4 py-2.5 font-medium">Prior P2P</th>
                      <th className="px-4 py-2.5 font-medium">Registered</th>
                      <th className="px-4 py-2.5 font-medium">Orders</th>
                      <th className="px-4 py-2.5 font-medium">Tradable Qty (USDT)</th>
                      <th className="px-4 py-2.5 font-medium">IDR</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-center">
                    {result.rows.map((b, i) => (
                      <tr key={i} className={`border-b border-surface-700/50 hover:bg-surface-900/40 ${b.isFtd ? 'bg-brand-500/5' : ''}`}>
                        <td className="px-4 py-2 text-surface-300 font-mono">{i + 1}</td>
                        <td className="px-4 py-2 text-surface-200 truncate max-w-[180px]">{b.nickName}</td>
                        <td className="px-4 py-2 font-mono text-surface-200">{b.priorP2P === null ? '—' : b.priorP2P}</td>
                        <td className="px-4 py-2 font-mono text-surface-200 text-xs">{fmtDate(b.registryTime)}</td>
                        <td className="px-4 py-2 font-mono text-surface-200">{b.orders}</td>
                        <td className="px-4 py-2 font-mono text-surface-50">{formatAmount(b.usdt, 2)}</td>
                        <td className="px-4 py-2 font-mono text-surface-200">{formatAmount(b.fiat, 0)}</td>
                        <td className="px-4 py-2">
                          {b.isFtd ? <span className="text-[11px] font-semibold rounded px-1.5 py-0.5 bg-brand-500/15 text-brand-400">FTD</span>
                            : b.captured ? <span className="text-[11px] font-semibold rounded px-1.5 py-0.5 bg-surface-700 text-surface-200">Returning</span>
                            : <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-warning/10 text-warning/80">not captured</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length === 0 && <p className="text-center py-10 text-surface-300 text-sm">No completed SELL orders in this range.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

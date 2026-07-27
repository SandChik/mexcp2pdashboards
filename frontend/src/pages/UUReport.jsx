import { useState, useEffect } from 'react';
import { merchantApi, ordersApi } from '../api';
import Layout from '../components/Layout';
import { downloadCsv, stamp } from '../csv';
import { formatAmount, normalizeState } from '../components/helpers';
import { Users, RefreshCw, CalendarRange, AlertTriangle, Download } from 'lucide-react';
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

export default function UUReport() {
  const [merchants, setMerchants] = useState([]);
  const [merchantSel, setMerchantSel] = useState('all');
  const [rangeKind, setRangeKind] = useState('event');
  const [custom, setCustom] = useState({ from: toDateStr(startOfDay()), to: toDateStr(Date.now()) });
  const [minBuy, setMinBuy] = useState('');
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
    const users = new Map(); // key: memberId (or nm:<nick>) -> { memberId, nickName, orders, usdt, approx }
    let totalOrders = 0, capped = false, unresolved = 0;

    try {
      for (const m of targets) {
        setStatus(`Loading orders — ${m.name}...`);
        const r = await ordersApi.market(m.id, { startTime, endTime });
        const raw = r.data;
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        const sellDone = list.filter(o => o.side === 'SELL' && normalizeState(o.state) === 4);
        totalOrders += sellDone.length;
        if (sellDone.length === 0) continue;

        setStatus(`Resolving real UIDs — ${m.name} (${sellDone.length} orders)...`);
        const advOrderNos = sellDone.map(o => o.advOrderNo);
        const mr = await ordersApi.memberIds(m.id, advOrderNos);
        const map = mr.data?.map || {};
        if (mr.data?.capped) capped = true;

        for (const o of sellDone) {
          const rec = map[o.advOrderNo] || {};
          const usdt = parseFloat(o.tradableQuantity) || 0;
          let key, approx = false;
          if (rec.memberId) key = 'id:' + rec.memberId;
          else { key = 'nm:' + (rec.nickName || o.userInfo?.nickName || o.advOrderNo); approx = true; unresolved++; }
          const u = users.get(key) || { memberId: rec.memberId || null, nickName: rec.nickName || o.userInfo?.nickName || '—', orders: 0, usdt: 0, approx };
          u.orders += 1; u.usdt += usdt;
          users.set(key, u);
        }
      }
    } catch (e) {
      toast.error('Failed: ' + (e.response?.data?.error || e.message));
      setLoading(false); setStatus(''); return;
    }

    const rows = [...users.values()].sort((a, b) => b.usdt - a.usdt);
    setResult({ totalOrders, rows, capped, unresolved });
    setLoading(false); setStatus('');
  }

  const min = parseFloat(minBuy) || 0;
  const rows = result ? result.rows.filter(u => u.usdt >= min) : [];
  const view = result && {
    totalOrders: result.totalOrders,
    uniqueUsers: rows.length,
    totalUsdt: rows.reduce((s, u) => s + u.usdt, 0),
    rows,
    capped: result.capped,
    unresolved: result.unresolved,
  };

  const card = 'bg-surface-800 border border-surface-700 rounded-lg p-4';

  function exportCsv() {
    if (!view) return;
    downloadCsv(`unique-users-${stamp()}.csv`,
      ['No', 'UID', 'Nickname', 'Jumlah order', 'Total USDT'],
      view.rows.map((u, i) => [i + 1, u.memberId || '', u.nickName || '', u.orders, u.usdt]));
  }

  return (
    <Layout>
      <div className="h-[100dvh] flex flex-col bg-surface-950 overflow-hidden">
        <header className="flex items-center gap-3 px-4 h-14 border-b border-surface-700 flex-shrink-0">
          <Users size={18} className="text-brand-400" />
          <h1 className="font-semibold text-surface-50 text-[15px]">Unique Users</h1>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Controls */}
          <div className={card}>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 sm:gap-4">
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
              <div>
                <label className="text-xs text-surface-300 uppercase tracking-wide block mb-1.5">Min purchase (USDT)</label>
                <input type="number" min="0" step="any" value={minBuy} onChange={e => setMinBuy(e.target.value)} placeholder="0"
                  className="bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-sm text-surface-50 font-mono focus:outline-none focus:border-brand-500 w-[130px]" />
              </div>
                <button onClick={exportCsv} disabled={!view || view.rows.length === 0}
                  className="flex items-center gap-1.5 text-xs text-surface-200 hover:text-surface-50 border border-surface-700 hover:bg-surface-800 rounded-lg px-3 py-2.5 transition-colors disabled:opacity-40">
                  <Download size={13} /> CSV
                </button>
              <button onClick={calculate} disabled={loading}
                className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium rounded-md px-5 py-2 flex items-center gap-2 transition-colors">
                {loading ? <RefreshCw size={15} className="animate-spin" /> : <Users size={15} />}{loading ? 'Calculating…' : 'Calculate UU'}
              </button>
            </div>
            {loading && status && <p className="text-xs text-brand-400 mt-2 font-mono">{status}</p>}
          </div>

          {view && (
            <>
              {min > 0 && <p className="text-xs text-surface-300">Counting only users with total purchase ≥ <span className="font-mono text-brand-400">{formatAmount(min, 2)}</span> USDT.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className={card}><p className="text-xs text-surface-300 uppercase tracking-wide">Completed SELL orders</p><p className="text-2xl font-mono font-semibold text-surface-50 mt-1">{view.totalOrders}</p></div>
                <div className={card}><p className="text-xs text-surface-300 uppercase tracking-wide">Unique users (UU)</p><p className="text-2xl font-mono font-semibold text-brand-400 mt-1">{view.uniqueUsers}</p></div>
                <div className={card}><p className="text-xs text-surface-300 uppercase tracking-wide">Total USDT sold</p><p className="text-2xl font-mono font-semibold text-sell mt-1">{formatAmount(view.totalUsdt, 2)}</p></div>
              </div>

              {(view.capped || view.unresolved > 0) && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {view.capped && 'Some orders exceeded the per-run lookup cap (600) — run again to resolve the rest (cached results make it fast). '}
                    {view.unresolved > 0 && `${view.unresolved} order(s) had no member ID and were counted by nickname (approximate).`}
                  </span>
                </div>
              )}

              <div className={card + ' !p-0 overflow-hidden'}>
                <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="border-b border-surface-700 text-center text-xs text-surface-300 uppercase tracking-wide">
                      <th className="px-4 py-2.5 font-medium">#</th>
                      <th className="px-4 py-2.5 font-medium">Member ID (UID)</th>
                      <th className="px-4 py-2.5 font-medium">Nickname</th>
                      <th className="px-4 py-2.5 font-medium">Orders</th>
                      <th className="px-4 py-2.5 font-medium">USDT</th>
                    </tr>
                  </thead>
                  <tbody className="text-center">
                    {view.rows.map((u, i) => (
                      <tr key={i} className="border-b border-surface-700/50 hover:bg-surface-900/40">
                        <td className="px-4 py-2 text-surface-300 font-mono">{i + 1}</td>
                        <td className="px-4 py-2 font-mono text-surface-50 text-xs">{u.memberId || <span className="text-warning">{u.nickName} (no UID)</span>}</td>
                        <td className="px-4 py-2 text-surface-200 truncate max-w-[220px] mx-auto">{u.nickName}</td>
                        <td className="px-4 py-2 font-mono text-surface-200">{u.orders}</td>
                        <td className="px-4 py-2 font-mono text-surface-50">{formatAmount(u.usdt, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
                {view.rows.length === 0 && <p className="text-center py-10 text-surface-300 text-sm">{min > 0 ? 'No users meet the minimum purchase in this range.' : 'No completed SELL orders in this range.'}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

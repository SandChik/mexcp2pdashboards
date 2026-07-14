import { useState, useEffect, useMemo } from 'react';
import { merchantApi, registryApi } from '../api';
import Layout from '../components/Layout';
import { formatAmount } from '../components/helpers';
import { BookUser, RefreshCw, Search, Trash2, AlertTriangle, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { askConfirm } from '../components/confirm';

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const fmtDate = (ts) => ts ? new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function BuyerLog() {
  const [merchants, setMerchants] = useState([]);
  const [merchantSel, setMerchantSel] = useState('all');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [dupOnly, setDupOnly] = useState(false);

  useEffect(() => { merchantApi.list().then(r => setMerchants(r.data)).catch(() => {}); }, []);

  async function load() {
    if (merchants.length === 0) return;
    setLoading(true);
    try {
      // Registry entries are stored per merchant; ?all=true returns everything
      // regardless of the :mid in the path, so any merchant id works as anchor.
      const anchor = merchantSel === 'all' ? merchants[0].id : merchantSel;
      const r = await registryApi.list(anchor, merchantSel === 'all');
      let recs = r.data?.records || [];
      if (merchantSel !== 'all') recs = recs.filter(x => x.merchantId === merchantSel);
      setRecords(recs);
    } catch (e) { toast.error('Gagal memuat catatan: ' + (e.response?.data?.error || e.message)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [merchants, merchantSel]); // eslint-disable-line

  const merchantName = (id) => merchants.find(m => m.id === id)?.name || id;

  const { rows, dupNames, uniqueNames } = useMemo(() => {
    const counts = {};
    records.forEach(r => { if (r.realName) { const k = normName(r.realName); counts[k] = (counts[k] || 0) + 1; } });
    const dups = new Set(Object.keys(counts).filter(k => counts[k] >= 2));
    let list = records.map(r => ({ ...r, _dup: r.realName ? dups.has(normName(r.realName)) : false, _dupCount: r.realName ? counts[normName(r.realName)] : 0 }));
    const query = q.trim().toLowerCase();
    if (query) list = list.filter(r =>
      (r.realName || '').toLowerCase().includes(query) ||
      (r.nickName || '').toLowerCase().includes(query) ||
      (r.advOrderNo || '').toLowerCase().includes(query));
    if (dupOnly) list = list.filter(r => r._dup);
    return { rows: list, dupNames: dups.size, uniqueNames: Object.keys(counts).length };
  }, [records, q, dupOnly]);

  async function removeRecord(r) {
    if (!await askConfirm({ title: 'Hapus catatan', message: `Hapus "${r.realName || r.nickName}" (order ${r.advOrderNo}) dari catatan buyer? Alert nama sama tidak akan menghitung entri ini lagi.`, confirmText: 'Hapus', danger: true })) return;
    try { await registryApi.remove(r.merchantId, r.advOrderNo); toast.success('Catatan dihapus'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Gagal menghapus'); }
  }

  const card = 'bg-surface-800 border border-surface-700 rounded-lg';
  const inp = 'bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-sm text-surface-50 focus:outline-none focus:border-brand-500';

  return (
    <Layout>
      <div className="h-screen flex flex-col bg-surface-950 overflow-hidden">
        <header className="flex items-center gap-3 px-4 h-14 border-b border-surface-700 flex-shrink-0">
          <BookUser size={18} className="text-brand-400" />
          <h1 className="font-semibold text-surface-50 text-[15px]">Catatan Buyer</h1>
          <span className="text-xs text-surface-300">nama KYC pembeli dari order yang selesai — sumber alert "nama sama"</span>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className={card + ' p-4'}>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-surface-300 uppercase tracking-wide block mb-1.5">Merchant</label>
                <select value={merchantSel} onChange={e => setMerchantSel(e.target.value)} className={inp + ' min-w-[180px]'}>
                  <option value="all">Semua merchant</option>
                  {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs text-surface-300 uppercase tracking-wide block mb-1.5">Cari</label>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-300" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nama KYC / nickname / no. order…"
                    className={inp + ' w-full pl-8'} />
                </div>
              </div>
              <button onClick={() => setDupOnly(d => !d)}
                className={`flex items-center gap-1.5 text-xs rounded-md px-3 py-2.5 border transition-colors ${dupOnly ? 'bg-sell/15 text-sell border-sell/40' : 'bg-surface-900 text-surface-300 border-surface-700 hover:text-surface-50'}`}>
                <AlertTriangle size={13} /> Hanya duplikat
              </button>
              <button onClick={load} disabled={loading}
                className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className={card + ' p-4'}><p className="text-xs text-surface-300 uppercase tracking-wide">Total catatan</p><p className="text-2xl font-mono font-semibold text-surface-50 mt-1">{records.length}</p></div>
            <div className={card + ' p-4'}><p className="text-xs text-surface-300 uppercase tracking-wide">Nama unik</p><p className="text-2xl font-mono font-semibold text-brand-400 mt-1">{uniqueNames}</p></div>
            <div className={card + ' p-4'}><p className="text-xs text-surface-300 uppercase tracking-wide">Nama duplikat</p><p className={`text-2xl font-mono font-semibold mt-1 ${dupNames ? 'text-sell' : 'text-surface-50'}`}>{dupNames}</p></div>
          </div>

          <div className={card + ' overflow-hidden'}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-left text-xs text-surface-300 uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Nama KYC</th>
                  <th className="px-4 py-2.5 font-medium">Nickname</th>
                  <th className="px-4 py-2.5 font-medium">Merchant</th>
                  <th className="px-4 py-2.5 font-medium">Selesai</th>
                  <th className="px-4 py-2.5 font-medium text-right">Nominal</th>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.advOrderNo} className={`border-b border-surface-700/50 hover:bg-surface-900/40 ${r._dup ? 'bg-sell/[0.05] border-l-2 border-l-sell' : ''}`}>
                    <td className="px-4 py-2">
                      <span className={r._dup ? 'text-sell font-medium' : 'text-surface-50'}>{r.realName || <span className="text-warning">tidak terbaca</span>}</span>
                      {r._dup && <span className="ml-2 text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-sell/15 text-sell ring-1 ring-sell/30">×{r._dupCount}</span>}
                    </td>
                    <td className="px-4 py-2 text-surface-200 truncate max-w-[160px]">{r.nickName || '—'}</td>
                    <td className="px-4 py-2 text-surface-300 text-xs">{merchantName(r.merchantId)}</td>
                    <td className="px-4 py-2 text-surface-200 font-mono text-xs">{fmtDate(r.doneAt)}</td>
                    <td className="px-4 py-2 text-right font-mono text-surface-50">{formatAmount(r.amount, 0)} <span className="text-surface-300 text-xs">{r.fiatUnit}</span></td>
                    <td className="px-4 py-2">
                      <button onClick={() => { navigator.clipboard.writeText(r.advOrderNo); toast.success('Order no disalin'); }}
                        title={r.advOrderNo} className="flex items-center gap-1 text-[11px] font-mono text-surface-300 hover:text-brand-400 transition-colors">
                        <Copy size={11} /> {String(r.advOrderNo).slice(-8)}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => removeRecord(r)} title="Hapus catatan"
                        className="text-surface-300 hover:text-sell transition-colors p-1"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-center py-12 text-surface-300 text-sm">
                {records.length === 0
                  ? 'Belum ada catatan. Nyalakan "Catat buyer & alert nama" di menu ⋮ panel merchant — order yang selesai akan otomatis tercatat di sini.'
                  : 'Tidak ada hasil untuk filter ini.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

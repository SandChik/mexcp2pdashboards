import { useState, useEffect } from 'react';
import { merchantApi } from '../api';
import { MessageSquare, Plus, Trash2, RotateCcw, RefreshCw, CopyPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { askConfirm } from './confirm';

// Message templates are now stored PER MERCHANT on the backend
// (merchant-settings.json). The backend returns Indonesian defaults for a
// merchant that has never been customized.

const SIDE_OPTIONS = [
  ['ANY', 'Semua order'],
  ['SELL', 'Jual (orang beli USDT ke saya)'],
  ['BUY', 'Beli (saya beli USDT)'],
];
const STATE_OPTIONS = [
  [-1, 'Order baru masuk (apa pun status)'],
  [0, 'Belum bayar (NOT_PAID)'],
  [1, 'Sudah bayar (PAID)'],
  [2, 'Menunggu proses (WAIT_PROCESS)'],
  [3, 'Diproses (PROCESSING)'],
  [4, 'Selesai (DONE)'],
  [5, 'Dibatalkan (CANCEL)'],
  [6, 'Invalid'],
  [7, 'Ditolak (REFUSE)'],
  [8, 'Timeout'],
];

const newRuleId = () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export default function MessageSettings() {
  const [merchants, setMerchants] = useState([]);
  const [mid, setMid] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quick, setQuick] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState([]);

  useEffect(() => {
    merchantApi.list().then(r => {
      setMerchants(r.data);
      if (r.data.length > 0) setMid(prev => prev || r.data[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mid) return;
    setLoading(true);
    merchantApi.getSettings(mid).then(r => {
      setQuick(Array.isArray(r.data?.quickReplies) ? r.data.quickReplies : []);
      setEnabled(r.data?.autoReplyEnabled !== false);
      setRules(Array.isArray(r.data?.autoReplyRules) ? r.data.autoReplyRules : []);
    }).catch(() => toast.error('Gagal memuat template merchant ini'))
      .finally(() => setLoading(false));
  }, [mid]);

  const inp = 'w-full bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-50 placeholder-surface-300/40 focus:outline-none focus:border-brand-500 transition-colors';
  const sel = 'bg-surface-900 border border-surface-700 rounded-lg px-2 py-1.5 text-xs text-surface-50 focus:outline-none focus:border-brand-500';

  async function persist(patch, okMsg) {
    setSaving(true);
    try { await merchantApi.setSettings(mid, patch); toast.success(okMsg); }
    catch { toast.error('Gagal menyimpan'); }
    finally { setSaving(false); }
  }

  const saveQuick = () => { const q = quick.filter(x => x.trim()); setQuick(q); persist({ quickReplies: q }, 'Quick replies disimpan'); };
  const saveRules = () => { const r = rules.filter(x => x.message.trim()); setRules(r); persist({ autoReplyRules: r }, 'Aturan auto-reply disimpan'); };
  const toggleEnabled = () => { const v = !enabled; setEnabled(v); persist({ autoReplyEnabled: v }, v ? 'Auto-reply ON' : 'Auto-reply OFF'); };
  const addRule = () => setRules([...rules, { id: newRuleId(), side: 'SELL', state: 0, message: '' }]);
  const patchRule = (id, patch) => setRules(rules.map(r => r.id === id ? { ...r, ...patch } : r));
  const delRule = (id) => setRules(rules.filter(r => r.id !== id));

  async function copyToAll() {
    const others = merchants.filter(m => m.id !== mid);
    if (others.length === 0) return toast.error('Tidak ada merchant lain');
    if (!await askConfirm({ title: 'Salin ke semua merchant', message: `Timpa quick replies + aturan auto-reply di ${others.length} merchant lain dengan template merchant ini?`, confirmText: 'Salin', danger: true })) return;
    setSaving(true);
    try {
      const payload = { quickReplies: quick.filter(x => x.trim()), autoReplyRules: rules.filter(x => x.message.trim()), autoReplyEnabled: enabled };
      for (const m of others) await merchantApi.setSettings(m.id, payload);
      toast.success(`Disalin ke ${others.length} merchant`);
    } catch { toast.error('Sebagian gagal disalin'); }
    finally { setSaving(false); }
  }

  const merchantName = merchants.find(m => m.id === mid)?.name || '';

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <MessageSquare size={15} className="text-brand-400" />
        <h2 className="font-display font-semibold text-surface-50 text-sm">Message templates</h2>
        {loading && <RefreshCw size={13} className="text-brand-400 animate-spin" />}
      </div>

      {/* Merchant selector — templates are per merchant now */}
      <div>
        <label className="block text-xs font-mono text-surface-300 uppercase tracking-wider mb-1">Merchant</label>
        <div className="flex gap-2">
          <select value={mid} onChange={e => setMid(e.target.value)} className={sel + ' flex-1 !py-2 !text-sm'}>
            {merchants.length === 0 && <option value="">— belum ada merchant —</option>}
            {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {merchants.length > 1 && (
            <button onClick={copyToAll} disabled={saving || !mid} title="Salin template merchant ini ke semua merchant lain"
              className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 hover:bg-brand-500/10 rounded-lg px-3 transition-colors disabled:opacity-40">
              <CopyPlus size={13} /> Salin ke semua
            </button>
          )}
        </div>
        <p className="text-[11px] text-surface-300 mt-1">Template di bawah hanya berlaku untuk <b className="text-surface-200">{merchantName || '—'}</b>. Tiap merchant punya set sendiri.</p>
      </div>

      {mid && !loading && (<>
        {/* Quick replies */}
        <div className="space-y-2">
          <p className="text-xs text-surface-300 uppercase tracking-wide">Quick replies (tombol cepat di chat)</p>
          {quick.map((q, i) => (
            <div key={i} className="flex gap-2">
              <input value={q} onChange={e => setQuick(quick.map((x, j) => j === i ? e.target.value : x))} className={inp} />
              <button onClick={() => setQuick(quick.filter((_, j) => j !== i))}
                className="text-surface-300 hover:text-sell px-2 transition-colors"><Trash2 size={15} /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setQuick([...quick, ''])}
              className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 rounded-lg px-3 py-1.5 transition-colors"><Plus size={13} /> Add</button>
            <button onClick={saveQuick} disabled={saving}
              className="text-xs bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors">Save quick replies</button>
          </div>
        </div>

        {/* Auto-reply rules */}
        <div className="space-y-3 pt-3 border-t border-surface-700">
          <div className="flex items-center justify-between">
            <p className="text-xs text-surface-300 uppercase tracking-wide">Auto-reply rules — {merchantName}</p>
            <button onClick={toggleEnabled}
              className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-brand-500 shadow-[0_0_10px_rgba(32,80,255,.5)]' : 'bg-surface-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {!enabled && <p className="text-[11px] text-surface-300">Auto-reply mati untuk merchant ini. Nyalakan toggle agar aturan dijalankan (selama dashboard terbuka).</p>}

          {rules.length === 0 && <p className="text-[11px] text-surface-300">Belum ada aturan. Klik "Add rule".</p>}
          {rules.map((r) => (
            <div key={r.id} className="bg-surface-900/60 border border-surface-700 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select value={r.side} onChange={e => patchRule(r.id, { side: e.target.value })} className={sel}>
                  {SIDE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select value={r.state} onChange={e => patchRule(r.id, { state: Number(e.target.value) })} className={sel}>
                  {STATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button onClick={() => delRule(r.id)} className="ml-auto text-surface-300 hover:text-sell px-1 transition-colors"><Trash2 size={15} /></button>
              </div>
              <textarea rows={2} value={r.message} placeholder="Pesan yang dikirim..." onChange={e => patchRule(r.id, { message: e.target.value })} className={inp + ' resize-none'} />
            </div>
          ))}

          <div className="flex gap-2">
            <button onClick={addRule}
              className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 rounded-lg px-3 py-1.5 transition-colors"><Plus size={13} /> Add rule</button>
            <button onClick={saveRules} disabled={saving}
              className="text-xs bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors">Save rules</button>
          </div>
          <p className="text-[11px] text-surface-300 leading-relaxed">
            Tiap aturan dikirim sekali per order saat order MEMASUKI status itu (tidak dobel). "Jual" = orang membeli USDT dari Anda; "Beli" = Anda membeli USDT. Hanya jalan selama dashboard terbuka.
          </p>
        </div>
      </>)}
    </div>
  );
}

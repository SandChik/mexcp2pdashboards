import { useState, useEffect } from 'react';
import { merchantApi } from '../api';
import { Plus, Trash2, RefreshCw, CopyPlus } from 'lucide-react';
import { SectionHeader, Card, Toggle, Disclosure, inputCls, btnSmGhost, btnSmPrimary } from './ui';
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
  [-3, 'Verifikasi: buyer mengirim dokumen'],
  [-2, 'Verifikasi diterima'],
  [-4, 'Verifikasi ditolak'],
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

  // Worker diagnostics: what the server-side sender did for this merchant.
  const [wstat, setWstat] = useState(null);
  useEffect(() => {
    if (!mid) return;
    let alive = true;
    const load = () => merchantApi.autoReplyStatus(mid).then(r => alive && setWstat(r.data)).catch(() => alive && setWstat(null));
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [mid]);
  const ago = (ts) => ts ? `${Math.max(0, Math.round((Date.now() - ts) / 1000))} dtk lalu` : '—';

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

  const inp = inputCls;
  const sel = 'bg-surface-900 border border-surface-700 rounded-lg px-2 py-1.5 text-xs text-surface-50 focus:outline-none focus:border-brand-500';

  async function persist(patch, okMsg) {
    setSaving(true);
    try { await merchantApi.setSettings(mid, patch); toast.success(okMsg); }
    catch { toast.error('Gagal menyimpan'); }
    finally { setSaving(false); }
  }

  const saveQuick = () => { const q = quick.filter(x => x.trim()); setQuick(q); persist({ quickReplies: q }, 'Balasan cepat disimpan'); };
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
  const plat = merchants.find(m => m.id === mid)?.platform;
  const workerTrouble = !!wstat && (!wstat.workerOn || !!wstat.lastError || !!wstat.skipped);

  return (
    <div className="space-y-3">
      <SectionHeader title="Auto-reply & balasan cepat"
        desc="Dikirim otomatis oleh server lewat chat bursa. Tiap merchant punya set sendiri." />

      {/* Merchant selector — templates are per merchant */}
      <div className="flex gap-2">
        <select value={mid} onChange={e => setMid(e.target.value)} aria-label="Merchant" className={sel + ' flex-1 !py-2 !text-sm'}>
          {merchants.length === 0 && <option value="">— belum ada merchant —</option>}
          {merchants.map(m => <option key={m.id} value={m.id}>{m.name} — {({ bingx: 'BingX', gate: 'Gate' })[m.platform] || 'MEXC'}</option>)}
        </select>
        {merchants.length > 1 && (
          <button onClick={copyToAll} disabled={saving || !mid} title="Salin template merchant ini ke semua merchant lain" className={`${btnSmGhost} !h-auto`}>
            <CopyPlus size={13} /> <span className="hidden xs:inline">Salin ke semua</span>
          </button>
        )}
        {loading && <RefreshCw size={14} className="text-brand-400 animate-spin self-center" />}
      </div>
      {['bingx', 'gate'].includes(plat) && (
        <p className="text-[11px] text-surface-300">{plat === 'gate' ? 'Gate' : 'BingX'}: dikirim lewat chat REST tiap 15 detik. Aturan "Verifikasi…" khusus MEXC.</p>
      )}

      {mid && !loading && (<>
        {/* Auto-reply rules */}
        <Card title={`Aturan auto-reply — ${merchantName}`}
          action={<Toggle on={enabled} onChange={toggleEnabled} label={enabled ? 'Auto-reply ON' : 'Auto-reply OFF'} />}>
          <div className={`space-y-2 ${enabled ? '' : 'opacity-60'}`}>
            {!enabled && <p className="text-[11px] text-surface-300">Auto-reply mati untuk merchant ini.</p>}
            {rules.length === 0 && <p className="text-[11px] text-surface-300">Belum ada aturan.</p>}
            {rules.map((r) => (
              <div key={r.id} className="bg-surface-900/60 border border-surface-700 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <select value={r.side} onChange={e => patchRule(r.id, { side: e.target.value })} aria-label="Sisi order" className={sel + ' min-w-0'}>
                    {SIDE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select value={r.state} onChange={e => patchRule(r.id, { state: Number(e.target.value) })} aria-label="Pemicu" className={sel + ' min-w-0 flex-1'}>
                    {STATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button onClick={() => delRule(r.id)} aria-label="Hapus aturan" className="text-surface-300 hover:text-sell px-1 transition-colors flex-shrink-0"><Trash2 size={15} /></button>
                </div>
                <textarea rows={2} value={r.message} placeholder="Pesan yang dikirim…" onChange={e => patchRule(r.id, { message: e.target.value })} className={inp + ' resize-none'} />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={addRule} className={btnSmGhost}><Plus size={13} /> Tambah aturan</button>
              <button onClick={saveRules} disabled={saving} className={btnSmPrimary}>Simpan aturan</button>
            </div>
            <p className="text-[11px] text-surface-300 leading-relaxed">
              Tiap aturan dikirim sekali per order saat order masuk ke status itu. Jual = orang membeli USDT dari Anda; Beli = Anda membeli USDT.
            </p>
          </div>
        </Card>

        {/* Worker status — answers "kenapa belum kirim?" without SSH. Opens itself when something is wrong. */}
        {wstat && (
          <Disclosure defaultOpen={workerTrouble}
            summary={<>Status worker server{workerTrouble ? <span className="text-warning"> · perlu dicek</span> : wstat.lastSentAt ? <span className="text-surface-300"> · kirim terakhir {ago(wstat.lastSentAt)}</span> : null}</>}>
            {!wstat.workerOn && <p className="text-sell">Worker DIMATIKAN (AUTO_REPLY_WORKER=0 di service).</p>}
            <p>siklus: {wstat.cycles} · terakhir {ago(wstat.lastCycleAt)} · interval {Math.round(wstat.intervalMs / 1000)}s · server hidup {Math.round(wstat.uptimeMs / 60000)} mnt</p>
            <p>order terlihat: {wstat.ordersSeen} (berjalan {wstat.running}) · aturan aktif: {wstat.rulesActive} · terkirim sejak restart: {wstat.sent}</p>
            {wstat.skipped && <p className="text-warning">dilewati: {wstat.skipped}</p>}
            {wstat.skipped === 'belum ada aturan' && rules.length > 0 && (
              <p className="text-sell">Aturan di layar ini BELUM tersimpan untuk merchant ini — klik "Simpan aturan".</p>
            )}
            {wstat.skipped === 'belum ada aturan' && rules.length === 0 && (
              <p className="text-sell">Merchant ini tidak punya aturan. Tambahkan lewat "Tambah aturan" lalu "Simpan aturan", atau buka merchant lain dan pakai "Salin ke semua".</p>
            )}
            {!wstat.primed && wstat.cycles === 0 && <p className="text-surface-300">belum ada siklus untuk merchant ini (baru ditambah? tunggu ≤15 dtk)</p>}
            {wstat.lastMatch && (
              <p>cocok terakhir: order …{String(wstat.lastMatch.advOrderNo).slice(-6)} aturan {wstat.lastMatch.rules.join(',')} ({wstat.lastMatch.isNew ? 'order baru' : `status ${wstat.lastMatch.prevState}→${wstat.lastMatch.state}`}) → <b className={wstat.lastMatch.result === 'terkirim' ? 'text-buy' : 'text-warning'}>{wstat.lastMatch.result || '…'}</b> · {ago(wstat.lastMatch.at)}</p>
            )}
            {wstat.lastSentAt && <p className="text-buy">kirim terakhir: {ago(wstat.lastSentAt)}</p>}
            {Array.isArray(wstat.verifyEvents) && wstat.verifyEvents.length > 0 && (
              <p className="text-surface-300">verifikasi terakhir: {wstat.verifyEvents.slice(0, 6).map(v => `…${String(v.advOrderNo).slice(-4)} ${v.kind === 'other' ? v.key : v.kind}`).join(' · ')}</p>
            )}
            {Array.isArray(wstat.transitions) && wstat.transitions.length > 0 && (
              // v76: the actual state hops the worker saw — proof of what a
              // verification order does after approval (2→0? 2→3?).
              <p className="text-surface-300">perpindahan status terakhir: {wstat.transitions.slice(0, 6).map(t => `…${String(t.advOrderNo).slice(-4)} ${t.from}→${t.to}`).join(' · ')}</p>
            )}
            {wstat.lastError && <p className="text-sell">error terakhir: {wstat.lastError}</p>}
            <p className="text-surface-300/80 font-sans">Aturan status hanya menyala saat order BERPINDAH ke status itu; order yang sudah ada saat server restart tidak dibalas. Aturan "Verifikasi…" dipicu pesan sistem MEXC di chat, jadi tetap jalan untuk order lama.</p>
          </Disclosure>
        )}

        {/* Quick replies */}
        <Card title="Balasan cepat (tombol di chat)">
          <div className="space-y-2">
            {quick.length === 0 && <p className="text-[11px] text-surface-300">Belum ada balasan cepat.</p>}
            {quick.map((q, i) => (
              <div key={i} className="flex gap-2">
                <input value={q} onChange={e => setQuick(quick.map((x, j) => j === i ? e.target.value : x))} className={inp} />
                <button onClick={() => setQuick(quick.filter((_, j) => j !== i))} aria-label="Hapus balasan"
                  className="text-surface-300 hover:text-sell px-2 transition-colors"><Trash2 size={15} /></button>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setQuick([...quick, ''])} className={btnSmGhost}><Plus size={13} /> Tambah</button>
              <button onClick={saveQuick} disabled={saving} className={btnSmPrimary}>Simpan balasan cepat</button>
            </div>
          </div>
        </Card>
      </>)}
    </div>
  );
}

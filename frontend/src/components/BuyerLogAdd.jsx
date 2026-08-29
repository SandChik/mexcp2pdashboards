import { useState, useEffect, useMemo } from 'react';
import { registryApi } from '../api';
import { downloadCsv, parseCsv, parseNum, parseDate } from '../csv';
import { askConfirm } from './confirm';
import toast from 'react-hot-toast';
import { X, Upload, FileDown, PencilLine, AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

/**
 * Add buyer-log entries from outside MEXC: typed by hand or imported from CSV.
 *
 * Why CSV and not .xlsx: parsing .xlsx needs a ~1MB dependency, and adding one
 * means regenerating package-lock — which the deploy gate (`npm ci`) rejects if
 * it drifts. Excel opens and saves this template natively, so the round trip
 * works without shipping a parser.
 *
 * Duplicate rule (chosen deliberately): two rows are "the same" when the KYC
 * NAME matches, ignoring case and extra spaces. A name that already exists is
 * NEVER added silently — it is listed for a per-row decision, because adding it
 * raises the ×N duplicate counter that drives the alert on order cards.
 */

// Canonical template columns. Order matters for the downloaded file only —
// import matches by header text, so a user may reorder or drop columns.
export const TEMPLATE_HEADERS = [
  'Nama KYC', 'Nickname', 'Tanggal Selesai', 'Nominal', 'Mata Uang', 'USDT', 'No. Order', 'Catatan',
];

export function downloadTemplate() {
  downloadCsv('template-catatan-buyer.csv', TEMPLATE_HEADERS, [
    ['Budi Santoso', 'budi_p2p', '2026-08-01 14:30', '1500000', 'IDR', '92.5', '', 'contoh — hapus baris ini'],
    ['Siti Rahayu', '', '2026-08-02', '500000', 'IDR', '', '', 'kolom selain Nama KYC boleh dikosongkan'],
  ]);
}

// Header aliases → internal field. Keys are compared after stripping anything
// that isn't a letter or digit, so "No. Order", "no_order" and "advOrderNo" all
// land on the same field. Unknown columns (e.g. Merchant/Duplikat from the CSV
// export) are ignored instead of breaking the import.
const FIELD_ALIASES = {
  realName:   ['namakyc', 'nama', 'namalengkap', 'name', 'realname', 'buyer'],
  nickName:   ['nickname', 'nick', 'namapanggilan', 'username'],
  doneAt:     ['tanggalselesai', 'tanggal', 'selesai', 'date', 'doneat', 'waktu'],
  amount:     ['nominal', 'amount', 'jumlah', 'nominalfiat'],
  fiatUnit:   ['matauang', 'currency', 'fiat', 'fiatunit'],
  usdt:       ['usdt', 'qty', 'quantity', 'jumlahusdt', 'kripto'],
  advOrderNo: ['noorder', 'nomororder', 'advorderno', 'order', 'orderno'],
  note:       ['catatan', 'note', 'keterangan', 'ket'],
};

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const DEFAULTS = { nickName: '—', fiatUnit: 'IDR', amount: 0, usdt: 0, note: '—' };

function mapHeaders(headers) {
  const map = {}; // column index -> field
  headers.forEach((h, i) => {
    const key = slug(h);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key) && !Object.values(map).includes(field)) { map[i] = field; return; }
    }
  });
  return map;
}

/** Turn parsed CSV into draft rows, applying defaults for blank optional cells. */
function rowsToDrafts(headers, rows) {
  const map = mapHeaders(headers);
  if (!Object.values(map).includes('realName')) {
    throw new Error('Kolom "Nama KYC" tidak ditemukan di file. Pakai template supaya nama kolomnya cocok.');
  }
  return rows.map((cells, i) => {
    const get = (field) => {
      const idx = Object.keys(map).find(k => map[k] === field);
      return idx === undefined ? '' : (cells[idx] ?? '');
    };
    const rawDate = get('doneAt');
    const ts = parseDate(rawDate);
    return {
      row: i + 2, // +2 = header line + 1-based
      realName: String(get('realName')).trim(),
      nickName: String(get('nickName')).trim(),
      doneAt: ts,
      dateUnreadable: !!rawDate && ts === null,
      amount: parseNum(get('amount')),
      fiatUnit: String(get('fiatUnit')).trim().toUpperCase(),
      usdt: parseNum(get('usdt')),
      advOrderNo: String(get('advOrderNo')).trim(),
      note: String(get('note')).trim(),
      force: false,
    };
  });
}

export default function BuyerLogAdd({ anchorId, onClose, onDone }) {
  const [tab, setTab] = useState('manual');
  const [drafts, setDrafts] = useState([]);       // rows waiting for review
  const [existing, setExisting] = useState(null); // Set of normalized names already logged
  const [loadingNames, setLoadingNames] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ realName: '', nickName: '', doneAt: '', amount: '', fiatUnit: 'IDR', usdt: '', note: '' });
  const [fileName, setFileName] = useState('');

  // Duplicate check must span every merchant, not just the one filtered on the
  // page behind this modal — hence ?all=true, fetched fresh on open.
  useEffect(() => {
    let stop = false;
    registryApi.list(anchorId || 'manual', true)
      .then(r => { if (!stop) setExisting(new Set(Object.keys(r.data?.nameIndex || {}))); })
      .catch(() => { if (!stop) setExisting(new Set()); })
      .finally(() => { if (!stop) setLoadingNames(false); });
    return () => { stop = true; };
  }, [anchorId]);

  // Status per draft: error (unusable) / dup (needs a decision) / ok.
  const reviewed = useMemo(() => {
    const seen = new Set();
    return drafts.map(d => {
      const key = normName(d.realName);
      let status = 'ok', reason = '';
      if (!key) { status = 'error'; reason = 'Nama KYC kosong — baris ini tidak bisa ditambahkan'; }
      else if (seen.has(key)) { status = 'dup'; reason = 'Nama ini muncul dua kali di dalam file yang sama'; }
      else if (existing && existing.has(key)) { status = 'dup'; reason = 'Nama ini sudah ada di catatan buyer'; }
      if (key) seen.add(key);
      return { ...d, status, reason };
    });
  }, [drafts, existing]);

  const counts = useMemo(() => ({
    ok: reviewed.filter(r => r.status === 'ok').length,
    dup: reviewed.filter(r => r.status === 'dup').length,
    dupForced: reviewed.filter(r => r.status === 'dup' && r.force).length,
    error: reviewed.filter(r => r.status === 'error').length,
  }), [reviewed]);

  function readFile(file) {
    if (!file) return;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      toast.error('File .xlsx belum didukung. Buka di Excel lalu "Save As" → CSV, baru unggah lagi.');
      return;
    }
    setFileName(file.name);
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const { headers, rows } = parseCsv(fr.result);
        if (rows.length === 0) { toast.error('File tidak berisi baris data'); return; }
        setDrafts(rowsToDrafts(headers, rows));
      } catch (e) { toast.error(e.message); }
    };
    fr.onerror = () => toast.error('Gagal membaca file');
    fr.readAsText(file, 'utf-8');
  }

  function addManualDraft() {
    if (!form.realName.trim()) { toast.error('Nama KYC wajib diisi'); return; }
    setDrafts(d => [...d, {
      row: d.length + 1,
      realName: form.realName.trim(),
      nickName: form.nickName.trim(),
      doneAt: form.doneAt ? parseDate(form.doneAt) : null,
      dateUnreadable: false,
      amount: parseNum(form.amount),
      fiatUnit: form.fiatUnit.trim().toUpperCase(),
      usdt: parseNum(form.usdt),
      advOrderNo: '',
      note: form.note.trim(),
      force: false,
    }]);
    setForm({ realName: '', nickName: '', doneAt: '', amount: '', fiatUnit: form.fiatUnit, usdt: '', note: '' });
  }

  const toggleForce = (row) => setDrafts(ds => ds.map(d => d.row === row ? { ...d, force: !d.force } : d));
  const dropRow = (row) => setDrafts(ds => ds.filter(d => d.row !== row));

  async function submit() {
    const payload = reviewed
      .filter(r => r.status === 'ok' || (r.status === 'dup' && r.force))
      .map(r => ({
        row: r.row,
        realName: r.realName,
        nickName: r.nickName || null,
        doneAt: r.doneAt || null,
        amount: r.amount === null ? DEFAULTS.amount : r.amount,
        usdt: r.usdt === null ? DEFAULTS.usdt : r.usdt,
        fiatUnit: r.fiatUnit || DEFAULTS.fiatUnit,
        note: r.note || null,
        advOrderNo: r.advOrderNo || undefined,
        force: r.status === 'dup',
      }));
    if (payload.length === 0) { toast.error('Tidak ada baris yang siap ditambahkan'); return; }

    const forced = payload.filter(p => p.force).length;
    const msg = [
      `${payload.length} baris akan ditambahkan ke catatan buyer.`,
      counts.dup - forced > 0 ? `${counts.dup - forced} baris duplikat dilewati.` : '',
      counts.error > 0 ? `${counts.error} baris tanpa nama dilewati.` : '',
      forced > 0
        ? `\n⚠ ${forced} nama yang sudah ada tetap ditambahkan. Akibatnya penghitung "nama sama" untuk nama itu naik, dan kartu order akan menandainya sebagai duplikat walau orangnya baru transaksi sekali.`
        : '',
    ].filter(Boolean).join(' ');

    if (!await askConfirm({
      title: forced > 0 ? 'Konfirmasi: ada duplikat yang dipaksa masuk' : 'Tambah ke catatan buyer',
      message: msg,
      confirmText: 'Tambahkan',
      cancelText: 'Batal',
      danger: forced > 0,
    })) return;

    setSaving(true);
    try {
      const r = await registryApi.addManual(payload, tab === 'import' ? 'import' : 'manual');
      const { added, skipped = [], batchId } = r.data || {};
      toast.success(`${added} catatan ditambahkan${skipped.length ? ` · ${skipped.length} dilewati server` : ''}`);
      onDone?.({ added, batchId });
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Gagal menambahkan catatan');
    } finally { setSaving(false); }
  }

  const inp = 'bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-sm text-surface-50 w-full focus:outline-none focus:border-brand-500';
  const lbl = 'text-xs text-surface-300 uppercase tracking-wide block mb-1.5';
  const tabBtn = (k, icon, text) => (
    <button onClick={() => setTab(k)}
      className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border transition-colors ${tab === k ? 'bg-brand-500/15 text-brand-400 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700 hover:text-surface-50'}`}>
      {icon} {text}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[9998] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      onMouseDown={onClose}>
      <div className="w-full max-w-3xl bg-surface-800 border border-surface-700 rounded-2xl shadow-lift my-4"
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 sm:px-5 h-14 border-b border-surface-700">
          <h3 className="font-semibold text-surface-50 text-[15px]">Tambah catatan buyer</h3>
          <span className="text-xs text-surface-300 hidden sm:inline">manual atau impor CSV — masuk ke merchant “Manual”</span>
          <button onClick={onClose} className="ml-auto text-surface-300 hover:text-surface-50 p-1"><X size={18} /></button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex gap-2">
            {tabBtn('manual', <PencilLine size={14} />, 'Input manual')}
            {tabBtn('import', <Upload size={14} />, 'Impor CSV')}
          </div>

          {tab === 'manual' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className={lbl}>Nama KYC <span className="text-sell">*</span></label>
                <input autoFocus value={form.realName} onChange={e => setForm({ ...form, realName: e.target.value })}
                  placeholder="Wajib" className={inp} />
              </div>
              <div><label className={lbl}>Nickname</label>
                <input value={form.nickName} onChange={e => setForm({ ...form, nickName: e.target.value })} placeholder="opsional" className={inp} /></div>
              <div><label className={lbl}>Tanggal selesai</label>
                <input type="datetime-local" value={form.doneAt} onChange={e => setForm({ ...form, doneAt: e.target.value })} className={inp} /></div>
              <div><label className={lbl}>Nominal</label>
                <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" className={inp} /></div>
              <div><label className={lbl}>Mata uang</label>
                <input value={form.fiatUnit} onChange={e => setForm({ ...form, fiatUnit: e.target.value })} placeholder="IDR" className={inp} /></div>
              <div><label className={lbl}>USDT</label>
                <input value={form.usdt} onChange={e => setForm({ ...form, usdt: e.target.value })} placeholder="0" className={inp} /></div>
              <div className="col-span-2 sm:col-span-2"><label className={lbl}>Catatan</label>
                <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="opsional — mis. sumber data" className={inp} /></div>
              <div className="flex items-end">
                <button onClick={addManualDraft}
                  className="w-full bg-surface-900 border border-surface-700 hover:border-brand-500 text-surface-50 text-sm rounded-md px-3 py-2 transition-colors">
                  Masukkan ke daftar
                </button>
              </div>
              <p className="col-span-2 sm:col-span-3 text-xs text-surface-300">
                Kolom kosong diisi default: nickname/catatan “—”, mata uang IDR, nominal &amp; USDT 0, tanggal = waktu penambahan.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={downloadTemplate}
                  className="flex items-center gap-1.5 text-xs text-surface-200 hover:text-surface-50 border border-surface-700 hover:bg-surface-900 rounded-lg px-3 py-2 transition-colors">
                  <FileDown size={13} /> Unduh template CSV
                </button>
                <label className="flex items-center gap-1.5 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-lg px-3 py-2 cursor-pointer transition-colors">
                  <Upload size={13} /> Pilih file CSV
                  <input type="file" accept=".csv,.txt,text/csv" className="hidden"
                    onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {fileName && <span className="text-xs text-surface-300 font-mono">{fileName}</span>}
              </div>
              <p className="text-xs text-surface-300 leading-relaxed">
                Hanya <b className="text-surface-100">Nama KYC</b> yang wajib. Urutan kolom bebas, kolom asing diabaikan,
                pemisah <code>;</code> / <code>,</code> / tab dikenali otomatis. File .xlsx belum didukung — simpan ulang sebagai CSV.
              </p>
            </div>
          )}

          {loadingNames && (
            <p className="flex items-center gap-2 text-xs text-surface-300"><Loader2 size={12} className="animate-spin" /> memuat daftar nama untuk pengecekan duplikat…</p>
          )}

          {reviewed.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="flex items-center gap-1 text-buy"><CheckCircle2 size={12} /> {counts.ok} siap</span>
                <span className="flex items-center gap-1 text-warning"><AlertTriangle size={12} /> {counts.dup} duplikat ({counts.dupForced} dipaksa masuk)</span>
                <span className="flex items-center gap-1 text-sell"><XCircle size={12} /> {counts.error} tidak valid</span>
              </div>

              {counts.dup > 0 && (
                <div className="flex gap-2 text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg p-3">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Baris kuning namanya sudah ada di catatan. Defaultnya <b>dilewati</b>. Kalau lo centang “tambah tetap”,
                    penghitung nama-sama untuk nama itu naik — kartu order akan menandainya duplikat meski orangnya baru transaksi sekali.
                  </p>
                </div>
              )}

              <div className="border border-surface-700 rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead className="sticky top-0 bg-surface-800">
                      <tr className="border-b border-surface-700 text-left text-xs text-surface-300 uppercase tracking-wide">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Nama KYC</th>
                        <th className="px-3 py-2 font-medium">Nickname</th>
                        <th className="px-3 py-2 font-medium text-right">Nominal</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewed.map(r => (
                        <tr key={r.row} className={`border-b border-surface-700/50 ${r.status === 'dup' ? 'bg-warning/[0.06]' : r.status === 'error' ? 'bg-sell/[0.06]' : ''}`}>
                          <td className="px-3 py-2 text-surface-300 font-mono text-xs">{r.row}</td>
                          <td className="px-3 py-2 text-surface-50">{r.realName || <span className="text-sell">kosong</span>}</td>
                          <td className="px-3 py-2 text-surface-300 text-xs">{r.nickName || DEFAULTS.nickName}</td>
                          <td className="px-3 py-2 text-right font-mono text-surface-200 text-xs">
                            {(r.amount === null ? 0 : r.amount).toLocaleString('id-ID')} {r.fiatUnit || DEFAULTS.fiatUnit}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {r.status === 'ok' && <span className="text-buy">siap</span>}
                            {r.status === 'error' && <span className="text-sell" title={r.reason}>tidak valid</span>}
                            {r.status === 'dup' && (
                              <label className="flex items-center gap-1.5 text-warning cursor-pointer" title={r.reason}>
                                <input type="checkbox" checked={!!r.force} onChange={() => toggleForce(r.row)} className="accent-current" />
                                tambah tetap
                              </label>
                            )}
                            {r.dateUnreadable && <span className="block text-surface-300">tanggal tak terbaca → waktu impor</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => dropRow(r.row)} title="Buang baris ini" className="text-surface-300 hover:text-sell p-1"><X size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-4 sm:px-5 py-4 border-t border-surface-700">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-surface-600 text-surface-200 hover:bg-surface-700 transition-colors">Tutup</button>
          <button onClick={submit} disabled={saving || loadingNames || (counts.ok + counts.dupForced) === 0}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Tambah {counts.ok + counts.dupForced} baris
          </button>
        </div>
      </div>
    </div>
  );
}

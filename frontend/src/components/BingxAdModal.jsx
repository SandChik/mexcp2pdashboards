import { useState, useEffect } from 'react';
import { X, RefreshCw, Info } from 'lucide-react';
import { adsApi } from '../api';
import { formatAmount } from './helpers';
import toast from 'react-hot-toast';

/**
 * BingX ad form — create (no existingAd) or edit (existingAd from the panel's
 * ads tab, which carries the raw myAdvert row in `_bingx`).
 *
 * Deliberately NOT a copy of AdModal (MEXC): the fields are different
 * (price type fixed/floating, taker conditions, hide-payment-info, payment
 * methods chosen from the merchant's own accounts). Ranges come from BingX's
 * assetConfig so a value the exchange would refuse is caught before sending.
 */

const PAY_TIME = [[1, '15 menit'], [2, '30 menit'], [3, '45 menit'], [4, '60 menit']];
const MAX_METHODS = { SELL: 3, BUY: 5 };
const CONDITION_FIELDS = [
  { key: 'registryDays',             label: 'Umur akun minimal (hari, 0–90)',              type: 'number', min: 0, max: 90 },
  { key: 'latestSuccessOrderCount',  label: 'Order sukses 60 hari terakhir minimal (0–10)', type: 'number', min: 0, max: 10 },
  { key: 'latestSuccessAppealCount', label: 'Kalah banding 60 hari terakhir maksimal (0–10)', type: 'number', min: 0, max: 10 },
  { key: 'isBindPhone',              label: 'Wajib sudah ikat nomor HP',                    type: 'bool' },
  { key: 'isTradeSpotOrStdContract', label: 'Wajib pernah trading spot/futures di BingX 60 hari terakhir', type: 'bool' },
  { key: 'registryCountryCode',      label: 'Negara akun (kode, pisahkan koma, kosong = semua)', type: 'text' },
];

// Hoisted on purpose: a component defined INSIDE BingxAdModal would be a new
// type on every render, so React would remount every input on each keystroke
// and the field would lose focus after one character.
const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-[11px] font-mono text-surface-300 uppercase tracking-wider mb-1">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-surface-300/80 mt-1">{hint}</p>}
  </div>
);
const input = 'w-full bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-surface-50 text-sm font-mono focus:outline-none focus:border-brand-500 transition-colors';

function condsFromAd(ad) {
  const out = {};
  (ad?._bingx?.userMatchConditions || []).forEach(c => {
    if (c?.conditionName && c.conditionValue !== undefined && c.conditionValue !== null && c.conditionValue !== '') out[c.conditionName] = String(c.conditionValue);
  });
  return out;
}

export default function BingxAdModal({ merchant, existingAd, onClose, onSaved }) {
  const editing = !!existingAd;
  const raw = existingAd?._bingx || {};
  const [side, setSide] = useState(existingAd?.side || 'SELL');
  const [form, setForm] = useState({
    priceType: existingAd?.priceType || 1,
    fixedPrice: existingAd?.price ?? '',
    floatRatio: existingAd?.floatRatio ?? '',
    totalNumber: existingAd?.totalNumber ?? '',
    availableAmount: existingAd?.availableAmount ?? '',
    minAmount: existingAd?.minAmount ?? '',
    maxAmount: existingAd?.maxAmount ?? '',
    paymentTimeLimit: existingAd?.paymentTimeLimit || 1,
    hidePaymentInfo: Number(existingAd?.hidePaymentInfo) === 1 ? 1 : 0,
    termsDesc: raw.termsDesc || '',
    autoReplyMsg: raw.autoReplyMsg || '',
  });
  const [methods, setMethods] = useState(() => (raw.paymentMethods || []).map(p => p.userPaymentMethodId).filter(Boolean));
  const [conds, setConds] = useState(() => condsFromAd(existingAd));
  const [myMethods, setMyMethods] = useState(null);   // merchant's accounts (null = loading)
  const [config, setConfig] = useState(null);         // assetConfig for this side
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const fiat = existingAd?.fiatUnit || 'IDR';

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    adsApi.paymentMethods(merchant.id).then(r => setMyMethods(r.data?.data || [])).catch(() => setMyMethods([]));
  }, [merchant.id]);

  useEffect(() => {
    setConfig(null);
    adsApi.config(merchant.id, { fiatUnit: fiat, tradeType: side === 'BUY' ? 1 : 2 })
      .then(r => setConfig(r.data?.data || null)).catch(() => {});
  }, [merchant.id, side, fiat]);

  const marketPrice = config ? Number(config.marketPrice) : null;
  const previewPrice = form.priceType === 2 && marketPrice && Number(form.floatRatio) > 0
    ? marketPrice * Number(form.floatRatio) / 100 : null;

  function toggleMethod(id) {
    setMethods(m => m.includes(id) ? m.filter(x => x !== id) : (m.length >= MAX_METHODS[side] ? (toast.error(`Maksimal ${MAX_METHODS[side]} metode untuk iklan ${side === 'SELL' ? 'jual' : 'beli'}`), m) : [...m, id]));
  }

  function validate() {
    const c = config || {};
    if (form.priceType === 1) {
      const p = Number(form.fixedPrice);
      if (!(p > 0)) return 'Harga tetap harus diisi';
      if (c.minFixedPrice && p < Number(c.minFixedPrice)) return `Harga di bawah batas BingX (${formatAmount(c.minFixedPrice, 0)})`;
      if (c.maxFixedPrice && p > Number(c.maxFixedPrice)) return `Harga di atas batas BingX (${formatAmount(c.maxFixedPrice, 0)})`;
    } else {
      const r = Number(form.floatRatio);
      if (!(r > 0)) return 'Rasio mengambang harus diisi';
      if (c.minPriceRatio && r < Number(c.minPriceRatio)) return `Rasio di bawah batas BingX (${c.minPriceRatio}%)`;
      if (c.maxPriceRatio && r > Number(c.maxPriceRatio)) return `Rasio di atas batas BingX (${c.maxPriceRatio}%)`;
    }
    const total = Number(form.totalNumber);
    if (!(total > 0)) return 'Total USDT harus diisi';
    if (c.minNumberPerAdvert && total < Number(c.minNumberPerAdvert)) return `Total USDT minimal ${formatAmount(c.minNumberPerAdvert, 2)}`;
    if (c.maxNumberPerAdvert && total > Number(c.maxNumberPerAdvert)) return `Total USDT maksimal ${formatAmount(c.maxNumberPerAdvert, 2)}`;
    const min = Number(form.minAmount), max = Number(form.maxAmount);
    if (!(min > 0) || !(max > 0)) return 'Limit min & max harus diisi';
    if (min >= max) return 'Limit min harus lebih kecil dari max';
    if (c.minAmountPerOrder && min < Number(c.minAmountPerOrder)) return `Limit min di bawah batas BingX (${formatAmount(c.minAmountPerOrder, 0)} ${fiat})`;
    if (c.maxAmountPerOrder && max > Number(c.maxAmountPerOrder)) return `Limit max di atas batas BingX (${formatAmount(c.maxAmountPerOrder, 0)} ${fiat})`;
    if (methods.length === 0) return 'Pilih minimal satu metode bayar';
    for (const f of CONDITION_FIELDS) {
      if (f.type === 'number' && conds[f.key] !== undefined && conds[f.key] !== '') {
        const v = Number(conds[f.key]);
        if (isNaN(v) || v < f.min || v > f.max) return `${f.label}: harus ${f.min}–${f.max}`;
      }
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }
    setLoading(true);
    try {
      const payload = {
        advNo: editing ? existingAd.advNo : undefined,
        side, asset: 'USDT', fiatUnit: fiat,
        priceType: form.priceType,
        fixedPrice: form.priceType === 1 ? String(form.fixedPrice) : undefined,
        floatRatio: form.priceType === 2 ? String(form.floatRatio) : undefined,
        totalNumber: String(form.totalNumber),
        availableAmount: editing && String(form.availableAmount).trim() !== '' ? String(form.availableAmount) : undefined,
        minAmount: String(form.minAmount), maxAmount: String(form.maxAmount),
        paymentTimeLimit: Number(form.paymentTimeLimit),
        userPaymentMethods: methods,
        hidePaymentInfo: side === 'SELL' ? form.hidePaymentInfo : undefined,
        termsDesc: form.termsDesc, autoReplyMsg: form.autoReplyMsg,
        userMatchConditions: Object.entries(conds)
          .filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false)
          .map(([k, v]) => ({ conditionName: k, conditionValue: String(v) })),
      };
      const r = await adsApi.saveOrUpdate(merchant.id, payload);
      if (r.data?.code === 0) {
        toast.success(editing ? 'Iklan BingX diperbarui' : `Iklan BingX dibuat${r.data?.data?.advertNo ? ` (#${r.data.data.advertNo})` : ''}`);
        onSaved?.(); onClose();
      } else toast.error(`BingX menolak: ${r.data?.msg || 'error'}${r.data?.code ? ` (code ${r.data.code})` : ''}`, { duration: 8000 });
    } catch (err) {
      toast.error(err.response?.data?.msg || err.response?.data?.error || err.message, { duration: 8000 });
    } finally { setLoading(false); }
  }


  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-fade-in" onMouseDown={onClose}>
      <form onSubmit={handleSubmit} onMouseDown={e => e.stopPropagation()}
        className="card !rounded-b-none sm:!rounded-xl w-full max-w-xl h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col animate-sheet-up sm:animate-slide-up shadow-lift">
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-surface-700 bg-surface-900">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center text-[10px] font-bold tracking-wide uppercase rounded-md px-1.5 py-0.5 ring-1 bg-warning/15 text-warning ring-warning/30">BingX</span>
            <h3 className="font-display font-semibold text-surface-50 text-sm truncate">{editing ? `Edit iklan #${existingAd.advNo}` : 'Iklan baru'} · {merchant.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-surface-300 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-surface-800">
          {/* Side — fixed once created */}
          <Field label="Jenis iklan" hint={editing ? 'Jenis tidak bisa diubah setelah iklan dibuat.' : 'Jual = Anda melepas USDT ke pembeli. Beli = Anda membeli USDT.'}>
            <div className="flex gap-2">
              {[['SELL', 'Jual USDT'], ['BUY', 'Beli USDT']].map(([k, l]) => (
                <button key={k} type="button" disabled={editing} onClick={() => setSide(k)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium border transition-colors disabled:opacity-60 ${
                    side === k ? (k === 'SELL' ? 'bg-sell/15 text-sell border-sell/40' : 'bg-buy/15 text-buy border-buy/40') : 'bg-surface-900 text-surface-300 border-surface-700'}`}>{l}</button>
              ))}
            </div>
          </Field>

          {/* Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Cara harga">
              <div className="flex gap-2">
                {[[1, 'Tetap'], [2, 'Mengambang']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => set('priceType', k)}
                    className={`flex-1 rounded-lg py-2 text-sm border transition-colors ${form.priceType === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700'}`}>{l}</button>
                ))}
              </div>
            </Field>
            {form.priceType === 1 ? (
              <Field label={`Harga per USDT (${fiat})`}
                hint={config ? `Pasar ${formatAmount(config.marketPrice, 0)} · boleh ${formatAmount(config.minFixedPrice, 0)}–${formatAmount(config.maxFixedPrice, 0)}` : 'memuat batas BingX…'}>
                <input value={form.fixedPrice} onChange={e => set('fixedPrice', e.target.value)} inputMode="decimal" className={input} placeholder="17750" />
              </Field>
            ) : (
              <Field label="Rasio terhadap harga pasar (%)"
                hint={config ? `Pasar ${formatAmount(config.marketPrice, 0)} · boleh ${config.minPriceRatio}%–${config.maxPriceRatio}%${previewPrice ? ` · sekarang ≈ ${formatAmount(previewPrice, 0)}` : ''}` : 'memuat batas BingX…'}>
                <input value={form.floatRatio} onChange={e => set('floatRatio', e.target.value)} inputMode="decimal" className={input} placeholder="101.5" />
              </Field>
            )}
          </div>

          {/* Stock + limits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Total USDT iklan" hint={config ? `boleh ${formatAmount(config.minNumberPerAdvert, 2)}–${formatAmount(config.maxNumberPerAdvert, 2)} USDT` : undefined}>
              <input value={form.totalNumber} onChange={e => set('totalNumber', e.target.value)} inputMode="decimal" className={input} placeholder="500" />
            </Field>
            {editing && (
              <Field label="Sisa iklan (USDT)" hint="Kosongkan untuk tidak mengubah sisa.">
                <input value={form.availableAmount} onChange={e => set('availableAmount', e.target.value)} inputMode="decimal" className={input} />
              </Field>
            )}
            <Field label={`Limit minimum per order (${fiat})`} hint={config ? `min ${formatAmount(config.minAmountPerOrder, 0)}` : undefined}>
              <input value={form.minAmount} onChange={e => set('minAmount', e.target.value)} inputMode="numeric" className={input} placeholder="100000" />
            </Field>
            <Field label={`Limit maksimum per order (${fiat})`} hint={config ? `maks ${formatAmount(config.maxAmountPerOrder, 0)}` : undefined}>
              <input value={form.maxAmount} onChange={e => set('maxAmount', e.target.value)} inputMode="numeric" className={input} placeholder="5000000" />
            </Field>
          </div>

          <Field label="Batas waktu bayar">
            <div className="grid grid-cols-4 gap-1.5">
              {PAY_TIME.map(([k, l]) => (
                <button key={k} type="button" onClick={() => set('paymentTimeLimit', k)}
                  className={`rounded-lg py-2 text-xs border transition-colors ${form.paymentTimeLimit === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700'}`}>{l}</button>
              ))}
            </div>
          </Field>

          {/* Payment methods */}
          <Field label={`Metode bayar (maks ${MAX_METHODS[side]})`} hint="Rekening diambil dari akun BingX Anda. Tambah rekening baru lewat aplikasi BingX.">
            {myMethods === null ? <div className="skeleton h-10 w-full" />
              : myMethods.length === 0 ? <p className="text-xs text-sell">Belum ada rekening tersimpan di BingX.</p>
              : (
                <div className="space-y-1.5">
                  {myMethods.map(pm => {
                    const on = methods.includes(pm.userPaymentMethodId);
                    return (
                      <button key={pm.userPaymentMethodId} type="button" onClick={() => toggleMethod(pm.userPaymentMethodId)}
                        className={`w-full text-left rounded-lg px-3 py-2 border transition-colors ${on ? 'bg-brand-500/10 border-brand-500/40' : 'bg-surface-900 border-surface-700 hover:border-surface-600'}`}>
                        <span className={`text-sm font-medium ${on ? 'text-brand-300' : 'text-surface-100'}`}>{pm.name}</span>
                        <span className="block text-[11px] text-surface-300 font-mono truncate">{pm.account ? `${pm.account}${pm.payee ? ` · ${pm.payee}` : ''}` : pm.summary || '—'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
          </Field>

          {side === 'SELL' && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={form.hidePaymentInfo === 1} onChange={e => set('hidePaymentInfo', e.target.checked ? 1 : 0)} className="mt-0.5" />
              <span className="text-sm text-surface-100">Sembunyikan info bayar
                <span className="block text-[11px] text-surface-300">Pembeli tidak melihat rekening sampai Anda mengirimkannya (aksi "kirim info bayar" — saat ini lewat aplikasi BingX). Biarkan mati kalau tidak yakin.</span>
              </span>
            </label>
          )}

          {/* Taker conditions */}
          <Field label="Syarat pembeli/penjual" hint="Kosongkan yang tidak dipakai.">
            <div className="space-y-2">
              {CONDITION_FIELDS.map(f => (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="text-xs text-surface-200 flex-1">{f.label}</span>
                  {f.type === 'bool'
                    ? <input type="checkbox" checked={conds[f.key] === 'true'} onChange={e => setConds(c => ({ ...c, [f.key]: e.target.checked ? 'true' : '' }))} />
                    : <input value={conds[f.key] ?? ''} onChange={e => setConds(c => ({ ...c, [f.key]: e.target.value }))}
                        inputMode={f.type === 'number' ? 'numeric' : 'text'} className={`${input} !w-28 !py-1.5`} />}
                </div>
              ))}
            </div>
          </Field>

          <Field label="Ketentuan transaksi (tampil ke lawan)">
            <textarea value={form.termsDesc} onChange={e => set('termsDesc', e.target.value)} rows={3} className={input} placeholder="Contoh: transfer atas nama sendiri, jangan tulis kata crypto di berita transfer." />
          </Field>
          <Field label="Pesan otomatis saat order dibuat">
            <textarea value={form.autoReplyMsg} onChange={e => set('autoReplyMsg', e.target.value)} rows={2} className={input} placeholder="Halo, mohon bayar sesuai nominal lalu klik sudah bayar." />
          </Field>

          {editing && (
            <div>
              <button type="button" onClick={() => setShowRaw(v => !v)} className="text-[11px] text-surface-300 hover:text-surface-50 border border-surface-700 rounded px-2 py-1">{showRaw ? 'Sembunyikan data mentah' : 'Data mentah BingX'}</button>
              {showRaw && <pre className="mt-2 bg-surface-950 border border-surface-700 rounded-lg p-3 text-[11px] text-surface-200 font-mono overflow-auto max-h-60 whitespace-pre-wrap break-all">{JSON.stringify(raw, null, 2)}</pre>}
            </div>
          )}

          <p className="flex items-start gap-2 text-[11px] text-surface-300"><Info size={12} className="flex-shrink-0 mt-0.5" /> Setelah disimpan, iklan langsung berubah di pasar BingX. Tidak ada tahap tinjau.</p>
        </div>

        <div className="flex gap-2 px-5 py-3.5 border-t-2 border-surface-700 bg-surface-900">
          <button type="button" onClick={onClose} className="flex-1 bg-surface-800 hover:bg-surface-700 text-surface-200 rounded-lg py-2.5 text-sm transition-colors">Batal</button>
          <button type="submit" disabled={loading || myMethods === null} className="flex-1 btn-primary !py-2.5 disabled:opacity-50">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : (editing ? 'Simpan perubahan' : 'Buat iklan')}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { X, RefreshCw, Info } from 'lucide-react';
import { adsApi, merchantApi } from '../api';
import { formatAmount } from './helpers';
import toast from 'react-hot-toast';

/**
 * Gate.io ad form — create (no existingAd) or edit (existingAd from the
 * panel's ads tab, which carries the raw my_ads_list row in `_gate`; the
 * edit form also loads ads_detail so every field is current).
 *
 * Laid out like the MEXC/BingX editors so the operator sees the same thing
 * on every platform. What is Gate-specific:
 *   - price: fixed (unitPrice) OR floating = reference × (1 ± offset%)
 *     (rateReferenceId 1 platform / 2 Gate / 3 spot, float_trend markup/markdown)
 *   - per-order limit in FIAT (limitBasis 1) or in crypto (limitBasis 0);
 *     the basis of an existing ad cannot be changed
 *   - payment accounts: one per pay TYPE (Gate's pay_type_json), picked from
 *     the merchant's own accounts (get_myself_payment)
 *   - counterparty conditions use Gate's "-1 / 0 = no limit" convention
 *   - trade terms / auto reply go through Gate's risk check (code 70305102)
 */

const PAY_TIME = [[15, '15 menit'], [20, '20 menit'], [30, '30 menit'], [45, '45 menit'], [60, '60 menit']];
const RATE_REFS = [['3', 'Harga spot'], ['2', 'Referensi Gate'], ['1', 'Referensi platform']];
const CONDITION_FIELDS = [
  { key: 'regTimeLimit',   label: 'Umur akun minimal (hari, 0 = bebas)',                      type: 'number', min: 0 },
  { key: 'minCompleted',   label: 'Order selesai minimal (-1 = bebas)',                       type: 'number', min: -1 },
  { key: 'maxCompleted',   label: 'Order selesai maksimal (-1 = bebas)',                      type: 'number', min: -1 },
  { key: 'completedRate',  label: 'Tingkat penyelesaian 30 hari minimal, % (-1 = bebas)',    type: 'number', min: -1 },
  { key: 'userOrders',     label: 'Order berjalan maksimal per lawan (-1 = bebas)',           type: 'number', min: -1 },
  { key: 'tierLimit',      label: 'Level VIP minimal (0 = bebas)',                            type: 'number', min: 0 },
  { key: 'verifiedLimit',  label: 'Level verifikasi minimal (0 = bebas)',                     type: 'number', min: 0 },
  { key: 'advertisersLimit', label: 'Tolak sesama pengiklan (merchant)',                      type: 'bool' },
  { key: 'polymarketLimit',  label: 'Tolak pengguna Polymarket',                              type: 'bool' },
];

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-[11px] font-mono text-surface-300 uppercase tracking-wider mb-1">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-surface-300/80 mt-1">{hint}</p>}
  </div>
);
const input = 'w-full bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-surface-50 text-sm font-mono focus:outline-none focus:border-brand-500 transition-colors';
const s = v => (v === undefined || v === null ? '' : String(v));
const limitOf = (v, bebas) => (v === undefined || v === null || Number(v) === bebas ? '' : String(v));

function condsFromRaw(d) {
  if (!d) return {};
  return {
    regTimeLimit: limitOf(d.reg_time_limit, 0),
    minCompleted: limitOf(d.min_completed_limit, -1),
    maxCompleted: limitOf(d.max_completed_limit, -1),
    completedRate: limitOf(d.completed_rate_limit, -1),
    userOrders: limitOf(d.user_orders_limit, -1),
    tierLimit: limitOf(d.tier_limit, 0),
    verifiedLimit: limitOf(d.verified_limit, 0),
    advertisersLimit: Number(d.advertisers_limit) === 1 ? 'true' : '',
    polymarketLimit: Number(d.polymarket_limit) === 1 ? 'true' : '',
  };
}

export default function GateAdModal({ merchant, existingAd, onClose, onSaved }) {
  const editing = !!existingAd;
  const raw = existingAd?._gate || {};
  const fiat = existingAd?.fiatUnit || merchant.fiat || 'IDR';
  const asset = existingAd?.coinName || merchant.asset || 'USDT';
  const [side, setSide] = useState(existingAd?.side || 'SELL');
  const [form, setForm] = useState(() => ({
    priceType: existingAd?.priceType || 1,
    fixedPrice: s(existingAd?.price),
    floatRatio: s(existingAd?.floatRatio),
    floatTrend: existingAd?.floatTrend === 1 ? 1 : 0,
    rateReferenceId: existingAd?.rateRefId > 0 ? String(existingAd.rateRefId) : '3',
    totalNumber: s(existingAd?.availableAmount),
    limitBasis: existingAd ? (existingAd.limitBasis === 0 || (existingAd.limitBasis === null && !existingAd.limitFiat) ? 0 : 1) : 1,
    minAmount: s(existingAd?.limitBasis === 0 ? existingAd?.limitCrypto?.min : existingAd?.limitFiat?.min ?? existingAd?.minAmount),
    maxAmount: s(existingAd?.limitBasis === 0 ? existingAd?.limitCrypto?.max : existingAd?.limitFiat?.max ?? existingAd?.maxAmount),
    paymentTimeLimit: Number(existingAd?.paymentTimeLimit) || 20,
    tradeTerms: raw.trade_tips || existingAd?.tradeTerms || '',
    autoReplyMsg: raw.auto_reply || existingAd?.autoReplyMsg || '',
  }));
  const [methods, setMethods] = useState(() => Object.values(existingAd?.payTypeJson || {}).map(String));
  const [conds, setConds] = useState(() => condsFromRaw(raw));
  const [myMethods, setMyMethods] = useState(null);   // merchant's accounts (null = loading)
  const [market, setMarket] = useState(null);         // { marketPrice, topAds }
  const [balance, setBalance] = useState(null);
  const [detailLoaded, setDetailLoaded] = useState(!editing);
  const [showRawMethods, setShowRawMethods] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    adsApi.paymentMethods(merchant.id).then(r => setMyMethods(r.data?.data || [])).catch(() => setMyMethods([]));
  }, [merchant.id]);

  // Edit: ads_detail carries the fields my_ads_list leaves out (limit basis,
  // fiat limits, reference id). Fill them in once it arrives.
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    adsApi.detail(merchant.id, existingAd.advNo).then(r => {
      if (!alive) return;
      const d = r.data?.data || {};
      const fixed = Number(d.rate_fixed) === 1 || Number(d.rate_ref_id) <= 0;
      const basis = Number(d.limit_basis) === 1 ? 1 : 0;
      setForm(f => ({
        ...f,
        priceType: fixed ? 1 : 2,
        fixedPrice: s(d.rate ?? f.fixedPrice),
        floatRatio: fixed ? f.floatRatio : s(Math.abs(Number(d.rate_offset) || 0)),
        floatTrend: Number(d.float_trend) === 1 ? 1 : 0,
        rateReferenceId: Number(d.rate_ref_id) > 0 ? String(d.rate_ref_id) : f.rateReferenceId,
        totalNumber: s(d.amount ?? f.totalNumber),
        limitBasis: basis,
        minAmount: s(basis === 1 ? (d.fiat_min_amount ?? d.minFiatAmount) : d.min_amount),
        maxAmount: s(basis === 1 ? (d.fiat_max_amount ?? d.maxFiatAmount) : d.max_amount),
        paymentTimeLimit: Number(d.expire_min) || f.paymentTimeLimit,
        tradeTerms: d.trade_tips ?? f.tradeTerms,
        autoReplyMsg: d.auto_reply ?? f.autoReplyMsg,
      }));
      try { const j = typeof d.pay_type_json === 'string' ? JSON.parse(d.pay_type_json) : d.pay_type_json; if (j && typeof j === 'object') setMethods(Object.values(j).map(String)); } catch { /* keep list row */ }
      setConds(condsFromRaw(d));
    }).catch(() => {}).finally(() => alive && setDetailLoaded(true));
    return () => { alive = false; };
  }, [merchant.id, editing]); // eslint-disable-line

  // Spot balance → the "Max" button and the default amount for a new ad.
  useEffect(() => {
    let alive = true;
    merchantApi.balance(merchant.id).then(r => {
      if (!alive) return;
      const b = r.data || {};
      setBalance(b);
      const free = Number(b.free);
      if (!(free > 0) || editing) return;
      const v = String(Math.floor(free * 100) / 100);
      setForm(f => (f.totalNumber === '' ? { ...f, totalNumber: v } : f));
    }).catch(e => alive && setBalance({ error: e.response?.data?.error || e.message }));
    return () => { alive = false; };
  }, [merchant.id]); // eslint-disable-line

  const freeBal = balance && Number(balance.free) > 0 ? Math.floor(Number(balance.free) * 100) / 100 : null;
  const balanceHint = balance === null ? 'memuat saldo…'
    : freeBal !== null ? `Saldo spot: ${formatAmount(balance.free, 2)} ${asset}${Number(balance.locked) > 0 ? ` (terkunci ${formatAmount(balance.locked, 2)})` : ''}`
    : balance.error ? `Saldo tidak terbaca — ${balance.error}` : 'Saldo 0 atau tidak terbaca';

  // Best market price for this side, from the public ad list — a sanity check
  // for the price field (Gate has no assetConfig-style range endpoint).
  useEffect(() => {
    setMarket(null);
    adsApi.config(merchant.id, { fiatUnit: fiat, side }).then(r => setMarket(r.data?.data || null)).catch(() => {});
  }, [merchant.id, side, fiat]);
  const marketPrice = market?.marketPrice ? Number(market.marketPrice) : null;
  const previewPrice = form.priceType === 2 && marketPrice && form.floatRatio !== ''
    ? marketPrice * (1 + (form.floatTrend === 1 ? -1 : 1) * Number(form.floatRatio) / 100) : null;

  // One account per pay TYPE (Gate's pay_type_json keys).
  const typeOf = (id) => myMethods?.find(pm => pm.id === id)?.payType;
  function toggleMethod(id) {
    setMethods(m => {
      if (m.includes(id)) return m.filter(x => x !== id);
      const t = typeOf(id);
      const clash = m.find(x => typeOf(x) === t);
      if (t !== undefined && clash !== undefined) {
        const cn = myMethods.find(pm => pm.id === clash)?.name;
        toast.error(`Gate hanya mengizinkan satu rekening per jenis — "${cn}" sudah dipilih untuk jenis "${t}"`);
        return m;
      }
      return [...m, id];
    });
  }

  function validate() {
    if (form.priceType === 1) {
      if (!(Number(form.fixedPrice) > 0)) return 'Harga tetap harus diisi';
    } else if (form.floatRatio === '' || isNaN(Number(form.floatRatio))) return 'Rasio mengambang harus diisi';
    if (!(Number(form.totalNumber) > 0)) return `Jumlah ${asset} iklan harus diisi`;
    const min = Number(form.minAmount), max = Number(form.maxAmount);
    if (!(min > 0) || !(max > 0)) return 'Limit min & max harus diisi';
    if (min >= max) return 'Limit min harus lebih kecil dari max';
    if (methods.length === 0) return 'Pilih minimal satu metode bayar';
    for (const f of CONDITION_FIELDS) {
      if (f.type === 'number' && conds[f.key] !== undefined && conds[f.key] !== '') {
        const v = Number(conds[f.key]);
        if (isNaN(v) || v < f.min) return `${f.label}: minimal ${f.min}`;
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
        side, fiatUnit: fiat,
        priceType: form.priceType,
        fixedPrice: form.priceType === 1 ? String(form.fixedPrice) : undefined,
        currentPrice: form.priceType === 2 ? String(existingAd?.price || marketPrice || '') : undefined,
        floatRatio: form.priceType === 2 ? String(form.floatRatio) : undefined,
        floatTrend: form.priceType === 2 ? form.floatTrend : undefined,
        rateReferenceId: form.priceType === 2 ? form.rateReferenceId : undefined,
        totalNumber: String(form.totalNumber),
        limitBasis: form.limitBasis,
        minAmount: String(form.minAmount), maxAmount: String(form.maxAmount),
        paymentIds: methods,
        paymentTimeLimit: Number(form.paymentTimeLimit),
        tradeTerms: form.tradeTerms, autoReplyMsg: form.autoReplyMsg,
        conditions: {
          regTimeLimit: conds.regTimeLimit, minCompleted: conds.minCompleted, maxCompleted: conds.maxCompleted,
          completedRate: conds.completedRate, userOrders: conds.userOrders, tierLimit: conds.tierLimit, verifiedLimit: conds.verifiedLimit,
          advertisersLimit: conds.advertisersLimit === 'true' ? 1 : 0, polymarketLimit: conds.polymarketLimit === 'true' ? 1 : 0,
        },
      };
      const r = await adsApi.saveOrUpdate(merchant.id, payload);
      if (r.data?.code === 0) {
        toast.success(editing ? 'Iklan Gate diperbarui' : 'Iklan Gate dibuat');
        onSaved?.(); onClose();
      } else toast.error(`Gate menolak: ${r.data?.msg || 'error'}${r.data?.code ? ` (code ${r.data.code})` : ''}`, { duration: 8000 });
    } catch (err) {
      toast.error(err.response?.data?.msg || err.response?.data?.error || err.message, { duration: 8000 });
    } finally { setLoading(false); }
  }

  const limitUnit = form.limitBasis === 1 ? fiat : asset;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-fade-in" onMouseDown={onClose}>
      <form onSubmit={handleSubmit} onMouseDown={e => e.stopPropagation()}
        className="card !rounded-b-none sm:!rounded-xl w-full max-w-xl h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col animate-sheet-up sm:animate-slide-up shadow-lift">
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-surface-700 bg-surface-900">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center text-[10px] font-bold tracking-wide uppercase rounded-md px-1.5 py-0.5 ring-1 bg-cyan-500/15 text-cyan-400 ring-cyan-500/30">Gate</span>
            <h3 className="font-display font-semibold text-surface-50 text-sm truncate">{editing ? `Edit iklan #${existingAd.advNo}` : 'Iklan baru'} · {merchant.name}</h3>
            {editing && !detailLoaded && <RefreshCw size={12} className="animate-spin text-surface-300" />}
          </div>
          <button type="button" onClick={onClose} className="text-surface-300 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-surface-800">
          <Field label="Jenis iklan" hint={editing ? 'Jenis tidak bisa diubah setelah iklan dibuat.' : `Jual = Anda melepas ${asset} ke pembeli. Beli = Anda membeli ${asset}.`}>
            <div className="flex gap-2">
              {[['SELL', `Jual ${asset}`], ['BUY', `Beli ${asset}`]].map(([k, l]) => (
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
              <Field label={`Harga per ${asset} (${fiat})`}
                hint={market === null ? 'memuat harga pasar…' : marketPrice ? `Iklan ${side === 'SELL' ? 'jual' : 'beli'} terbaik di pasar Gate: ${formatAmount(marketPrice, 2)}` : 'Harga pasar tidak terbaca'}>
                <input value={form.fixedPrice} onChange={e => set('fixedPrice', e.target.value)} inputMode="decimal" className={input} placeholder="16500" />
              </Field>
            ) : (
              <Field label="Selisih terhadap harga referensi (%)"
                hint={`${marketPrice ? `Pasar ≈ ${formatAmount(marketPrice, 2)}` : 'Pasar tidak terbaca'}${previewPrice ? ` · perkiraan ≈ ${formatAmount(previewPrice, 2)}` : ''}`}>
                <div className="flex gap-1.5">
                  <input value={form.floatRatio} onChange={e => set('floatRatio', e.target.value)} inputMode="decimal" className={input} placeholder="0.5" />
                  <button type="button" onClick={() => set('floatTrend', form.floatTrend === 1 ? 0 : 1)} title="Arah: markup (+) atau markdown (−) dari referensi"
                    className={`flex-shrink-0 px-3 rounded-lg text-sm font-mono border ${form.floatTrend === 1 ? 'border-sell/40 text-sell' : 'border-buy/40 text-buy'}`}>{form.floatTrend === 1 ? '−' : '+'}</button>
                </div>
              </Field>
            )}
          </div>
          {form.priceType === 2 && (
            <Field label="Harga referensi">
              <div className="grid grid-cols-3 gap-1.5">
                {RATE_REFS.map(([k, l]) => (
                  <button key={k} type="button" onClick={() => set('rateReferenceId', k)}
                    className={`rounded-lg py-2 text-xs border transition-colors ${form.rateReferenceId === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700'}`}>{l}</button>
                ))}
              </div>
            </Field>
          )}

          {/* Stock + limits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={editing ? `Sisa iklan (${asset})` : `Jumlah ${asset} iklan`} hint={balanceHint}>
              <div className="flex gap-1.5">
                <input value={form.totalNumber} onChange={e => set('totalNumber', e.target.value)} inputMode="decimal" className={input} placeholder="500" />
                <button type="button" onClick={() => freeBal !== null && set('totalNumber', String(freeBal))} disabled={freeBal === null} title="Isi dengan seluruh saldo spot"
                  className="flex-shrink-0 px-3 rounded-lg text-xs font-semibold border border-brand-500/40 text-brand-300 hover:bg-brand-500/10 disabled:opacity-40">Max</button>
              </div>
            </Field>
            <Field label="Satuan limit per order" hint={editing ? 'Satuan limit tidak bisa diubah saat edit (aturan Gate).' : 'Fiat = seperti MEXC (mis. Rp 100.000 – 5.000.000).'}>
              <div className="flex gap-2">
                {[[1, `Fiat (${fiat})`], [0, `Kripto (${asset})`]].map(([k, l]) => (
                  <button key={k} type="button" disabled={editing} onClick={() => set('limitBasis', k)}
                    className={`flex-1 rounded-lg py-2 text-xs border transition-colors disabled:opacity-60 ${form.limitBasis === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700'}`}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label={`Limit minimum per order (${limitUnit})`}>
              <input value={form.minAmount} onChange={e => set('minAmount', e.target.value)} inputMode="decimal" className={input} placeholder={form.limitBasis === 1 ? '100000' : '10'} />
            </Field>
            <Field label={`Limit maksimum per order (${limitUnit})`} hint={form.limitBasis === 1 ? 'Tidak boleh melebihi jumlah iklan × harga.' : undefined}>
              <input value={form.maxAmount} onChange={e => set('maxAmount', e.target.value)} inputMode="decimal" className={input} placeholder={form.limitBasis === 1 ? '5000000' : '500'} />
            </Field>
          </div>

          <Field label="Batas waktu bayar">
            <div className="grid grid-cols-5 gap-1.5">
              {PAY_TIME.map(([k, l]) => (
                <button key={k} type="button" onClick={() => set('paymentTimeLimit', k)}
                  className={`rounded-lg py-2 text-xs border transition-colors ${form.paymentTimeLimit === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700'}`}>{l}</button>
              ))}
            </div>
          </Field>

          {/* Payment methods */}
          <Field label="Metode bayar (satu per jenis)" hint="Rekening diambil dari akun Gate Anda (get_myself_payment). Gate memasangkan satu rekening per jenis (bank, e-wallet, …) ke tiap iklan. Tambah rekening baru lewat situs/aplikasi Gate.">
            {myMethods === null ? <div className="skeleton h-10 w-full" />
              : myMethods.length === 0 ? <p className="text-xs text-sell">Belum ada rekening tersimpan di Gate untuk {fiat}.</p>
              : (
                <div className="space-y-1.5">
                  {myMethods.map(pm => {
                    const on = methods.includes(pm.id);
                    const blocked = !on && methods.some(x => typeOf(x) === pm.payType);
                    return (
                      <button key={pm.id} type="button" onClick={() => toggleMethod(pm.id)}
                        title={blocked ? 'Jenis ini sudah dipilih — Gate hanya mengizinkan satu rekening per jenis' : undefined}
                        className={`w-full text-left rounded-lg px-3 py-2 border transition-colors ${on ? 'bg-brand-500/10 border-brand-500/40' : blocked ? 'bg-surface-900 border-surface-700/50 opacity-45' : 'bg-surface-900 border-surface-700 hover:border-surface-600'}`}>
                        <span className={`text-sm font-medium ${on ? 'text-brand-300' : 'text-surface-100'}`}>{pm.name}
                          <span className="ml-2 text-[10px] font-mono text-surface-300">{pm.payName || pm.payType} · #{pm.id}</span>
                        </span>
                        <span className="block text-[11px] text-surface-300 font-mono truncate">{pm.account ? `${pm.account}${pm.payee ? ` · ${pm.payee}` : ''}` : pm.summary || '—'}</span>
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setShowRawMethods(v => !v)} className="text-[11px] text-surface-300 hover:text-surface-50 border border-surface-700 rounded px-2 py-1">{showRawMethods ? 'Sembunyikan' : 'Data mentah rekening Gate'}</button>
                  {showRawMethods && <pre className="bg-surface-950 border border-surface-700 rounded-lg p-3 text-[11px] text-surface-200 font-mono overflow-auto max-h-60 whitespace-pre-wrap break-all">{JSON.stringify(myMethods, null, 2)}</pre>}
                </div>
              )}
          </Field>

          {/* Counterparty conditions */}
          <Field label="Syarat lawan transaksi" hint="Kosongkan yang tidak dipakai (= bebas).">
            <div className="space-y-2">
              {CONDITION_FIELDS.map(f => (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="text-xs text-surface-200 flex-1">{f.label}</span>
                  {f.type === 'bool'
                    ? <input type="checkbox" checked={conds[f.key] === 'true'} onChange={e => setConds(c => ({ ...c, [f.key]: e.target.checked ? 'true' : '' }))} />
                    : <input value={conds[f.key] ?? ''} onChange={e => setConds(c => ({ ...c, [f.key]: e.target.value }))}
                        inputMode="numeric" className={`${input} !w-28 !py-1.5`} />}
                </div>
              ))}
            </div>
          </Field>

          <Field label="Ketentuan transaksi (tampil ke lawan)" hint="Diperiksa risk control Gate — teks yang mengajak transaksi di luar Gate ditolak (code 70305102).">
            <textarea value={form.tradeTerms} onChange={e => set('tradeTerms', e.target.value)} rows={3} className={input} placeholder="Contoh: transfer atas nama sendiri, jangan tulis kata crypto di berita transfer." />
          </Field>
          <Field label="Pesan otomatis saat order dibuat">
            <textarea value={form.autoReplyMsg} onChange={e => set('autoReplyMsg', e.target.value)} rows={2} className={input} placeholder="Halo, mohon bayar sesuai nominal lalu klik sudah bayar." />
          </Field>

          {editing && (
            <div>
              <button type="button" onClick={() => setShowRaw(v => !v)} className="text-[11px] text-surface-300 hover:text-surface-50 border border-surface-700 rounded px-2 py-1">{showRaw ? 'Sembunyikan data mentah' : 'Data mentah Gate'}</button>
              {showRaw && <pre className="mt-2 bg-surface-950 border border-surface-700 rounded-lg p-3 text-[11px] text-surface-200 font-mono overflow-auto max-h-60 whitespace-pre-wrap break-all">{JSON.stringify(raw, null, 2)}</pre>}
            </div>
          )}

          <p className="flex items-start gap-2 text-[11px] text-surface-300"><Info size={12} className="flex-shrink-0 mt-0.5" /> Setelah disimpan, iklan langsung berubah di pasar Gate. Tidak ada tahap tinjau.</p>
        </div>

        <div className="flex gap-2 px-5 py-3.5 border-t-2 border-surface-700 bg-surface-900">
          <button type="button" onClick={onClose} className="flex-1 bg-surface-800 hover:bg-surface-700 text-surface-200 rounded-lg py-2.5 text-sm transition-colors">Batal</button>
          <button type="submit" disabled={loading || myMethods === null || !detailLoaded} className="flex-1 btn-primary !py-2.5 disabled:opacity-50">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : (editing ? 'Simpan perubahan' : 'Buat iklan')}
          </button>
        </div>
      </form>
    </div>
  );
}

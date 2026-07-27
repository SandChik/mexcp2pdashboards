import { useState } from 'react';
import { X, Zap } from 'lucide-react';
import { adsApi } from '../api';
import { formatAmount } from './helpers';
import toast from 'react-hot-toast';

// MEXC platform limits (IDR / USDT)
const IDR_MIN = 80000;
const IDR_MAX = 300000000;
const USDT_MIN = 100;
const USDT_MAX = 150000;
const PAY_TIME_OPTIONS = [15, 20, 25, 30];

export default function AdModal({ merchantId, existingAd, onClose, onSaved }) {
  if (!existingAd) { onClose(); return null; }
  const adNo = existingAd.advNo || existingAd.davNo;

  const kycAdvanced = existingAd.kycLevel === 'ADVANCED' || existingAd.kycLevel === 2;

  // Payment methods are managed on MEXC directly. We carry the ad's existing
  // payMethod through unchanged (it's a required field) and never expose a picker.
  const carriedPayMethod = (() => {
    if (existingAd.paymentInfo?.length > 0) return existingAd.paymentInfo.map(p => p.id).join(',');
    if (existingAd.payMethod) return String(existingAd.payMethod);
    return '';
  })();

  const availableQty = parseFloat(existingAd.availableQuantity) || 0;
  const frozenQty = parseFloat(existingAd.frozenQuantity) || 0;

  const [form, setForm] = useState({
    price: existingAd.price || '',
    minSingleTransAmount: existingAd.minSingleTransAmount || '',
    maxSingleTransAmount: existingAd.maxSingleTransAmount || '',
    payTimeLimit: PAY_TIME_OPTIONS.includes(Number(existingAd.payTimeLimit)) ? Number(existingAd.payTimeLimit) : 15,
    newStock: '',
    autoReplyMsg: existingAd.autoReplyMsg || '',
    tradeTerms: existingAd.tradeTerms || '',
  });
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function calcMaxIDR() {
    const price = parseFloat(form.price);
    if (!price) { toast.error('Enter a price first'); return; }
    set('maxSingleTransAmount', Math.floor(Math.min(availableQty * price, IDR_MAX)).toString());
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const price = parseFloat(form.price);
    const min = parseFloat(form.minSingleTransAmount);
    const max = parseFloat(form.maxSingleTransAmount);

    if (!price || price <= 0) { toast.error('Price is required'); return; }
    if (!carriedPayMethod) { toast.error('This ad has no payment method set. Add one on MEXC first.'); return; }
    if (isNaN(min) || min < IDR_MIN) { toast.error(`Min must be at least ${formatAmount(IDR_MIN, 0)} IDR`); return; }
    if (isNaN(max) || max > IDR_MAX) { toast.error(`Max can't exceed ${formatAmount(IDR_MAX, 0)} IDR`); return; }
    if (min >= max) { toast.error('Min must be lower than max'); return; }

    const newStock = parseFloat(form.newStock);
    const hasNewStock = !isNaN(newStock) && form.newStock !== '';
    if (hasNewStock) {
      if (newStock < USDT_MIN) { toast.error(`Stock must be at least ${USDT_MIN} USDT`); return; }
      if (newStock > USDT_MAX) { toast.error(`Stock max is ${formatAmount(USDT_MAX, 0)} USDT per update`); return; }
    }
    const initQty = hasNewStock ? newStock : Math.min(Math.max(availableQty, USDT_MIN), USDT_MAX);

    setLoading(true);
    try {
      // Start from the FULL existing ad object instead of a curated list of
      // field names. A curated allowlist silently drops any setting whose API
      // field name isn't in our docs (e.g. "Specific countries", "No trading
      // with merchant") — those got wiped on every edit. Spreading the whole
      // ad carries through everything MEXC itself reports for it, known or not.
      // We only drop fields that are clearly response-only/computed and would
      // be meaningless (or risky) to send back as request params.
      const SKIP = new Set([
        'availableQuantity', 'frozenQuantity', 'tradableQuantity',
        'createTime', 'updateTime', 'id', 'merchantId', 'merchantName',
        'davNo', 'paymentInfo', 'userInfo', 'advStatus',
      ]);
      const base = {};
      for (const [k, v] of Object.entries(existingAd)) {
        if (!SKIP.has(k) && v !== undefined && v !== null) base[k] = v;
      }
      const payload = {
        fiatUnit: 'IDR',
        ...base,
        // Explicit overrides — the few things this form actually lets you edit.
        advNo: adNo,
        price,
        initQuantity: initQty,
        minSingleTransAmount: min,
        maxSingleTransAmount: max,
        payMethod: carriedPayMethod,            // carried through, unchanged
        payTimeLimit: Number(form.payTimeLimit),
        kycLevel: kycAdvanced ? 'ADVANCED' : 'PRIMARY',
      };
      // Non-ASCII (Indonesian text, emoji) is fine now — the backend signs the
      // raw string and sends URL-encoded, so these go through unchanged.
      if (form.autoReplyMsg) payload.autoReplyMsg = form.autoReplyMsg;
      if (form.tradeTerms) payload.tradeTerms = form.tradeTerms;

      const r = await adsApi.saveOrUpdate(merchantId, payload);
      if (r.data?.code === 0) { toast.success('Ad updated'); onSaved?.(); onClose(); }
      else toast.error('MEXC: ' + (r.data?.msg || 'Error'));
    } catch (err) {
      toast.error('Error: ' + (err.response?.data?.msg || err.message));
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-fade-in">
      <div className="card !rounded-b-none sm:!rounded-xl w-full max-w-lg max-h-[92dvh] flex flex-col shadow-lift animate-sheet-up sm:animate-slide-up">

        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700">
          <div>
            <h2 className="font-semibold text-surface-50">Edit ad</h2>
            <p className="text-xs text-surface-300 font-mono mt-0.5">{adNo}</p>
          </div>
          <button onClick={onClose} className="text-surface-300 hover:text-surface-50"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">

          <div className="flex justify-end -mb-2">
            <button type="button" onClick={() => setShowRaw(v => !v)}
              className="text-[11px] text-surface-300 hover:text-surface-50 border border-surface-700 rounded px-2 py-1">
              {showRaw ? 'Hide raw' : 'Raw ad data'}
            </button>
          </div>
          {showRaw && (
            <pre className="bg-surface-950 border border-surface-700 rounded-lg p-3 text-[11px] text-surface-200 font-mono overflow-auto max-h-72 whitespace-pre-wrap break-all">
              {JSON.stringify(existingAd, null, 2)}
            </pre>
          )}

          <div className="grid grid-cols-3 gap-2">
            {[['Token', 'USDT'], ['Fiat', existingAd.fiatUnit || 'IDR'], ['Side', existingAd.side]].map(([k, v]) => (
              <div key={k}>
                <Label>{k}</Label>
                <div className={`${INP} ${k === 'Side' ? (existingAd.side === 'BUY' ? 'text-buy' : 'text-sell') + ' font-semibold' : 'text-surface-300'} cursor-not-allowed select-none`}>{v}</div>
              </div>
            ))}
          </div>

          <div>
            <Label required>Price (per USDT)</Label>
            <input type="number" value={form.price} onChange={e => set('price', e.target.value)}
              required step="any" placeholder="e.g. 17765" className={INP} />
          </div>

          {/* Stock */}
          <div>
            <div className="bg-surface-900 border border-surface-700 rounded-md p-3 mb-3 grid grid-cols-2 gap-3 text-center">
              <div><p className="text-xs text-surface-300">Available</p><p className="text-base text-buy font-mono font-semibold">{formatAmount(availableQty, 4)}</p></div>
              <div><p className="text-xs text-surface-300">In orders</p><p className="text-base text-warning font-mono font-semibold">{formatAmount(frozenQty, 4)}</p></div>
            </div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Set new stock (USDT) <span className="text-surface-300 normal-case">— leave empty to keep</span></Label>
              {availableQty > 0 && (
                <button type="button" onClick={() => set('newStock', Math.min(availableQty, USDT_MAX).toFixed(4))}
                  className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-0.5"><Zap size={10} /> Max</button>
              )}
            </div>
            <input type="number" value={form.newStock} onChange={e => set('newStock', e.target.value)}
              step="any" min={USDT_MIN} placeholder={`${USDT_MIN} – ${formatAmount(USDT_MAX, 0)}`} className={INP} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Min amount (IDR)</Label>
              <input type="number" value={form.minSingleTransAmount} onChange={e => set('minSingleTransAmount', e.target.value)}
                required step="any" placeholder={`min ${formatAmount(IDR_MIN, 0)}`} className={INP} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label required>Max amount (IDR)</Label>
                <button type="button" onClick={calcMaxIDR} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-0.5"><Zap size={10} /> Calc</button>
              </div>
              <input type="number" value={form.maxSingleTransAmount} onChange={e => set('maxSingleTransAmount', e.target.value)}
                required step="any" placeholder={`max ${formatAmount(IDR_MAX, 0)}`} className={INP} />
            </div>
          </div>

          <div>
            <Label required>Payment time limit</Label>
            <div className="grid grid-cols-4 gap-2">
              {PAY_TIME_OPTIONS.map(t => (
                <button key={t} type="button" onClick={() => set('payTimeLimit', t)}
                  className={`py-2 rounded-md text-sm border transition-colors ${
                    form.payTimeLimit === t ? 'bg-brand-500/15 text-brand-400 border-brand-500/40' : 'bg-surface-900 text-surface-300 border-surface-700 hover:text-surface-50'}`}>
                  {t} min
                </button>
              ))}
            </div>
          </div>



          <div>
            <Label>Auto-reply message <span className="text-surface-300 normal-case">— line breaks are kept</span></Label>
            <textarea value={form.autoReplyMsg} onChange={e => set('autoReplyMsg', e.target.value)}
              rows={5} maxLength={1000} placeholder={"Sent automatically when an order opens.\nPress Enter for a new line."}
              className={`${INP} resize-none whitespace-pre-wrap`} />
          </div>
          <div>
            <Label>Trade terms</Label>
            <textarea value={form.tradeTerms} onChange={e => set('tradeTerms', e.target.value)}
              rows={3} className={`${INP} resize-none`} placeholder="Shown to the buyer before they order" />
          </div>
        </form>

        <div className="px-5 py-4 border-t border-surface-700 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 border border-surface-700 text-surface-200 hover:bg-surface-900 rounded-md py-2.5 text-sm transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-md py-2.5 text-sm font-medium transition-colors">
            {loading ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const LBL = 'text-xs text-surface-300 uppercase tracking-wider';
const INP = 'w-full bg-surface-900 border border-surface-700 rounded-md px-3 py-2.5 text-surface-50 text-sm focus:outline-none focus:border-brand-500 transition-colors font-mono';
function Label({ children, required }) {
  return <label className={`${LBL} block mb-1.5`}>{children}{required && <span className="text-sell ml-1">*</span>}</label>;
}
function ToggleRow({ label, hint, on, onClick, value }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="min-w-0"><p className="text-sm text-surface-50">{label}</p>{hint && <p className="text-[11px] text-surface-300 truncate">{hint}</p>}</div>
      <div className="flex items-center gap-2 flex-shrink-0">{value}<Toggle on={on} onClick={onClick} /></div>
    </div>
  );
}
function Toggle({ on, onClick, small }) {
  const w = small ? 'w-10 h-5' : 'w-11 h-6';
  const k = small ? 'w-4 h-4 top-0.5' : 'w-4 h-4 top-1';
  const tx = on ? (small ? 'translate-x-5' : 'translate-x-6') : (small ? 'translate-x-0.5' : 'translate-x-1');
  return (
    <button type="button" onClick={onClick} className={`${w} rounded-full transition-colors relative flex-shrink-0 ${on ? 'bg-brand-500' : 'bg-surface-700'}`}>
      <div className={`absolute ${k} rounded-full bg-white transition-transform ${tx}`} />
    </button>
  );
}

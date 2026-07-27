// ─── Bank / Payment Method Map ───────────────────────────────────────────────
export const BANK_MAP = {
  176: 'SeaBank', 456: 'BCA', 459: 'OVO', 460: 'GoPay',
  463: 'ShopeePay', 469: 'DANA', 455: 'Blu BCA', 462: 'Allo Bank',
  465: 'CIMB Niaga', 461: 'Bank Jago', 452: 'BRI', 454: 'Permata',
  457: 'Mandiri', 569: 'Bank Transfer', 458: 'BNI', 738: 'Superbank'
};

export function getBankName(payMethod) {
  const id = parseInt(payMethod);
  return BANK_MAP[id] || (payMethod ? `Method ${payMethod}` : '-');
}

// Get label(s) from ad's paymentInfo array (preferred) or payMethod string
export function getAdPaymentLabel(ad) {
  // Use paymentInfo if available (has correct bank type IDs from payMethod field)
  if (ad?.paymentInfo?.length > 0) {
    const names = ad.paymentInfo.map(p => getBankName(p.payMethod));
    const unique = [...new Set(names)];
    if (unique.length <= 2) return unique.join(' · ');
    return unique.slice(0, 2).join(' · ') + ` +${unique.length - 2}`;
  }
  // Fallback: payMethod might be comma-separated user IDs or single bank type ID
  if (ad?.payMethod) {
    const ids = String(ad.payMethod).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 1) return getBankName(ids[0]);
    return `${ids.length} methods`;
  }
  return '-';
}

// ─── Order States ─────────────────────────────────────────────────────────────
export const ORDER_STATES = {
  0: { label: 'Belum bayar', color: 'text-warning bg-warning/10',     group: 'active',    accent: 'border-l-warning' },
  1: { label: 'Sudah bayar', color: 'text-brand-300 bg-brand-500/10', group: 'active',    accent: 'border-l-brand-400' },
  2: { label: 'Menunggu',    color: 'text-warning bg-warning/10',     group: 'active',    accent: 'border-l-warning' },
  3: { label: 'Diproses',    color: 'text-cyan-400 bg-cyan-500/10',   group: 'active',    accent: 'border-l-cyan-400' },
  4: { label: 'Selesai',     color: 'text-buy bg-buy/10',             group: 'done',      accent: 'border-l-buy' },
  5: { label: 'Dibatalkan',  color: 'text-surface-200 bg-surface-700', group: 'cancelled', accent: 'border-l-surface-600' },
  6: { label: 'Invalid',     color: 'text-sell bg-sell/10',           group: 'cancelled', accent: 'border-l-sell' },
  7: { label: 'Ditolak',     color: 'text-sell bg-sell/10',           group: 'cancelled', accent: 'border-l-sell' },
  8: { label: 'Timeout',     color: 'text-sell bg-sell/10',           group: 'cancelled', accent: 'border-l-sell' },
};

export const KYC_LABELS = { 0: 'None', 1: 'Primary', 2: 'Advanced' };

export function normalizeState(s) {
  if (s === null || s === undefined) return -1;
  if (typeof s === 'number') return s;
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  const map = {
    NOT_PAID: 0, PAID: 1, WAIT_PROCESS: 2, PROCESSING: 3,
    DONE: 4, CANCEL: 5, CANCELLED: 5, INVALID: 6, REFUSE: 7, TIMEOUT: 8
  };
  return map[String(s).toUpperCase()] ?? -1;
}

// ─── Badges ───────────────────────────────────────────────────────────────────
export function OrderStateBadge({ state }) {
  const n = normalizeState(state);
  const s = ORDER_STATES[n] || { label: `State${n}`, color: 'text-surface-300 bg-surface-800' };
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${s.color}`}>{s.label}</span>;
}

export function SideBadge({ side }) {
  const isBuy = side === 'BUY';
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono font-bold tracking-wide ${isBuy ? 'text-buy bg-buy/10 ring-1 ring-buy/20' : 'text-sell bg-sell/10 ring-1 ring-sell/20'}`}>
      {side}
    </span>
  );
}

export function AdStatusBadge({ status }) {
  const isOpen = status === 'OPEN' || status === 'open' || status === 1;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-medium ${isOpen ? 'text-buy bg-buy/10' : 'text-surface-300 bg-surface-900'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-buy' : 'bg-surface-300'}`} />{isOpen ? 'LIVE' : 'OFF'}
    </span>
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────
export function formatTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

export function formatAmount(val, decimals = 2) {
  if (val === undefined || val === null || val === '') return '-';
  const n = parseFloat(val);
  if (isNaN(n)) return '-';
  return n.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}


// Compact number (47.6M, 6.9K) — keeps panel stats one line so panels align
export function formatCompact(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

// ─── Sounds ───────────────────────────────────────────────────────────────────
// Implementation moved to src/sounds.js (shared AudioContext + soft bell tones,
// distinct motif per order state). Re-exported here for existing imports.
export { playSound, previewSound, soundForState, SOUND_EVENTS, getSoundPrefs, setSoundPrefs } from '../sounds';

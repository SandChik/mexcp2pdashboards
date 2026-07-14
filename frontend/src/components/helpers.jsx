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
  0: { label: 'Unpaid',     color: 'text-warning bg-warning/10',  group: 'active'    },
  1: { label: 'Paid',       color: 'text-brand-400 bg-brand-500/10', group: 'active' },
  2: { label: 'Waiting',    color: 'text-warning bg-warning/10',  group: 'active'    },
  3: { label: 'Processing', color: 'text-warning bg-warning/10',  group: 'active'    },
  4: { label: 'Done',       color: 'text-buy bg-buy/10',          group: 'done'      },
  5: { label: 'Cancelled',  color: 'text-surface-300 bg-surface-800', group: 'cancelled' },
  6: { label: 'Invalid',    color: 'text-sell bg-sell/10',        group: 'cancelled' },
  7: { label: 'Refused',    color: 'text-sell bg-sell/10',        group: 'cancelled' },
  8: { label: 'Timeout',    color: 'text-sell bg-sell/10',        group: 'cancelled' },
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
  return <span className={`text-xs px-2 py-0.5 rounded-sm font-mono font-medium ${s.color}`}>{s.label}</span>;
}

export function SideBadge({ side }) {
  const isBuy = side === 'BUY';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-sm font-mono font-bold ${isBuy ? 'text-buy bg-buy/10' : 'text-sell bg-sell/10'}`}>
      {side}
    </span>
  );
}

export function AdStatusBadge({ status }) {
  const isOpen = status === 'OPEN' || status === 'open' || status === 1;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-sm font-mono font-medium ${isOpen ? 'text-buy bg-buy/10' : 'text-surface-300 bg-surface-800'}`}>
      {isOpen ? 'OPEN' : 'CLOSED'}
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
function beep(freq, dur, vol = 0.7, type = 'square', delay = 0) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur / 1000);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur / 1000);
  } catch {}
}

export function playNewOrderSound() {
  beep(880, 150, 0.8, 'square', 0);
  beep(1100, 150, 0.8, 'square', 0.18);
  beep(1320, 250, 0.9, 'square', 0.36);
}

export function playNewMessageSound() {
  beep(1200, 100, 0.6, 'sine', 0);
  beep(1500, 150, 0.6, 'sine', 0.12);
}

export function playStateChangeSound() {
  beep(660, 120, 0.7, 'square', 0);
  beep(880, 200, 0.8, 'square', 0.15);
}

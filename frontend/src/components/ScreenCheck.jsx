import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { viewportGuardState } from '../viewportGuard';

// "Cek layar" (v86): one screenshot of this overlay tells exactly how iOS sized
// the Home-Screen app — viewport vs physical screen, safe areas, where the dock
// ended up and what the viewport guard did. Coloured stripes mark three
// candidate "bottoms" so the picture shows which one is the real screen edge.

function probe(style) {
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: '1px', visibility: 'hidden', pointerEvents: 'none' }, style);
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const r = { h: el.offsetHeight, pt: parseFloat(cs.paddingTop) || 0, pb: parseFloat(cs.paddingBottom) || 0 };
  el.remove();
  return r;
}

function measure() {
  const ua = navigator.userAgent || '';
  const ios = (ua.match(/OS (\d+)_(\d+)(?:_(\d+))?/) || []).slice(1).filter(Boolean).join('.');
  let dm = '-';
  try { dm = window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'; } catch { /* ignore */ }
  const vv = window.visualViewport;
  const safe = probe({ height: '0', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' });
  const dock = document.querySelector('nav.dock.md\\:hidden');
  const dr = dock ? dock.getBoundingClientRect() : null;
  return {
    'iOS': ios || '(bukan iOS)',
    'Mode': `${dm} · standalone=${String(navigator.standalone)}`,
    'Layar fisik (screen)': `${screen.width} × ${screen.height}`,
    'Viewport (inner)': `${window.innerWidth} × ${window.innerHeight}`,
    'visualViewport': vv ? `${Math.round(vv.height)} (offsetTop ${Math.round(vv.offsetTop)})` : '-',
    'clientHeight': String(document.documentElement.clientHeight),
    '100vh / lvh': `${probe({ height: '100vh' }).h} / ${probe({ height: '100lvh' }).h}`,
    '100dvh / svh': `${probe({ height: '100dvh' }).h} / ${probe({ height: '100svh' }).h}`,
    'Safe area atas / bawah': `${safe.pt} / ${safe.pb}`,
    'Dock: bawah → bawah viewport': dr ? `${Math.round(window.innerHeight - dr.bottom)} px` : '-',
    'Dock: bawah → bawah layar fisik': dr ? `${Math.round(screen.height - dr.bottom)} px` : '-',
    'Penjaga viewport': (() => { const s = viewportGuardState(); return `${s.reason || '-'}; ${s.tries}x coba${s.lastTry ? ` (terakhir ${s.lastTry})` : ''}`; })(),
    'Hasil terakhir': viewportGuardState().lastResult || '-',
  };
}

const stripe = 'fixed z-[61] h-1.5 pointer-events-none';

export default function ScreenCheck({ onClose }) {
  const [m, setM] = useState(measure);
  useEffect(() => {
    const t = setInterval(() => setM(measure()), 1000);
    return () => clearInterval(t);
  }, []);
  const sh = typeof screen !== 'undefined' ? screen.height : 0;

  return (
    <>
      <div className="fixed inset-x-3 z-[60] top-[calc(env(safe-area-inset-top)+10px)] max-h-[58dvh] overflow-auto card p-3 border border-brand-500/40 shadow-glow">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-surface-50">Cek layar</h3>
          <button onClick={onClose} aria-label="Tutup" className="p-1.5 rounded-lg text-surface-200 hover:text-surface-50 hover:bg-surface-800"><X size={16} /></button>
        </div>
        <p className="text-[11px] text-surface-200 mb-2 leading-relaxed">
          Ambil screenshot layar ini (dengan dock terlihat di bawah) lalu kirim. Garis
          <span className="text-sell font-semibold"> merah</span> (kiri) = bawah viewport,
          <span className="text-buy font-semibold"> hijau</span> (tengah) = 100lvh,
          <span className="text-warning font-semibold"> kuning</span> (kanan) = tinggi layar fisik.
        </p>
        <dl className="text-[11px] font-mono grid grid-cols-[minmax(0,45%)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {Object.entries(m).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-surface-300">{k}</dt>
              <dd className="text-surface-50 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {/* Three candidate bottoms; whichever touches the real screen edge wins. */}
      <div className={`${stripe} left-0 w-1/3 bottom-0 bg-sell`} />
      <div className={`${stripe} left-1/3 w-1/3 bg-buy`} style={{ top: 'calc(100lvh - 6px)' }} />
      <div className={`${stripe} right-0 w-1/3 bg-warning`} style={{ top: sh - 6 }} />
    </>
  );
}

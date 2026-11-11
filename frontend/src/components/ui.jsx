// Small shared building blocks for the Settings screens (v81) — one look for
// headers, cards, switches and form fields instead of five hand-rolled ones.
import { ChevronRight } from 'lucide-react';

export const inputCls =
  'w-full bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-50 ' +
  'placeholder-surface-300/50 focus:outline-none focus:border-brand-500 transition-colors';

export const btnSm =
  'inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg px-3 h-8 border transition-colors disabled:opacity-50';
export const btnSmGhost = `${btnSm} border-surface-700 text-surface-200 hover:text-surface-50 hover:bg-surface-800`;
export const btnSmPrimary = `${btnSm} border-brand-500 bg-brand-500 text-white hover:bg-brand-600`;

/** Title + one-line description + optional action on the right. */
export function SectionHeader({ title, desc, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-surface-50">{title}</h2>
        {desc && <p className="text-xs text-surface-300 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`card p-4 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {title && <h3 className="text-sm font-medium text-surface-50">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-surface-200 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-surface-300 mt-1 leading-relaxed">{hint}</span>}
    </label>
  );
}

// !min-h-0: the global touch rule (min-height 40px on coarse pointers) would
// stretch the track into a blob; the invisible ::after keeps a big tap area.
export function Toggle({ on, onChange, label, disabled, small }) {
  const w = small ? 'w-9 h-5' : 'w-11 h-6';
  const k = small ? 'w-4 h-4' : 'w-5 h-5';
  const x = small ? 'left-[18px]' : 'left-[22px]';
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} title={label}
      disabled={disabled} onClick={() => onChange(!on)}
      className={`relative ${w} !min-h-0 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 after:absolute after:-inset-2.5 after:content-[''] ${on ? 'bg-brand-500' : 'bg-surface-700'}`}>
      <span className={`absolute top-0.5 ${k} rounded-full bg-white shadow transition-all ${on ? x : 'left-0.5'}`} />
    </button>
  );
}

/** Collapsed-by-default block for diagnostics: there when you need it, out of the way when you don't. */
export function Disclosure({ summary, defaultOpen = false, children }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-surface-700 bg-surface-900/60">
      <summary className="flex items-center gap-1.5 cursor-pointer select-none list-none px-3 py-2 text-xs text-surface-200 hover:text-surface-50">
        <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="px-3 pb-3 text-[11px] font-mono text-surface-200 space-y-1">{children}</div>
    </details>
  );
}

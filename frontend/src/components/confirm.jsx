import { createRoot } from 'react-dom/client';

// Promise-based confirmation rendered as a CENTERED modal overlay (replaces window.confirm).
// Usage: if (await askConfirm({ title, message, confirmText, danger })) { ... }
export function askConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (val) => { document.removeEventListener('keydown', onKey, true); try { root.unmount(); } catch {} host.remove(); resolve(val); };
    // Capture phase, before any page-level shortcut handler: Enter confirms,
    // Escape cancels, and everything else is swallowed so pressing R/C/Enter
    // on the queue page can never fire a second action underneath the dialog.
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return; // dialogs never contain these today, but keep typing sane if they do
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
      else if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else e.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    root.render(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        data-confirm-open="1" onClick={() => close(false)}>
        <div className={`w-full max-w-md card border ${danger ? '!border-sell/40' : ''} !rounded-2xl shadow-lift p-5 sm:p-6 animate-slide-up`}
          onClick={(e) => e.stopPropagation()}>
          {title && <h3 className={`text-lg font-semibold ${danger ? 'text-sell' : 'text-surface-50'}`}>{title}</h3>}
          <p className="text-sm text-surface-200 mt-2 whitespace-pre-line leading-relaxed">{message}</p>
          <div className="flex gap-3 justify-end mt-6">
            <button onClick={() => close(false)}
              className="text-sm px-4 py-2 rounded-lg border border-surface-600 text-surface-200 hover:bg-surface-700 transition-colors">
              {cancelText} <kbd className="ml-1.5 text-[10px] opacity-60 border border-surface-500 rounded px-1">Esc</kbd>
            </button>
            <button onClick={() => close(true)} autoFocus
              className={`text-sm px-4 py-2 rounded-lg text-white font-medium transition-colors ${danger ? 'bg-sell hover:bg-sell/80' : 'bg-brand-500 hover:bg-brand-600'}`}>
              {confirmText} <kbd className="ml-1.5 text-[10px] opacity-70 border border-white/30 rounded px-1">Enter</kbd>
            </button>
          </div>
        </div>
      </div>
    );
  });
}

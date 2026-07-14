import { createRoot } from 'react-dom/client';

// Promise-based confirmation rendered as a CENTERED modal overlay (replaces window.confirm).
// Usage: if (await askConfirm({ title, message, confirmText, danger })) { ... }
export function askConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (val) => { try { root.unmount(); } catch {} host.remove(); resolve(val); };
    root.render(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={() => close(false)}>
        <div className={`w-full max-w-md bg-surface-800 border ${danger ? 'border-sell/40' : 'border-surface-700'} rounded-2xl shadow-2xl shadow-black/70 p-6`}
          onClick={(e) => e.stopPropagation()}>
          {title && <h3 className={`text-lg font-semibold ${danger ? 'text-sell' : 'text-surface-50'}`}>{title}</h3>}
          <p className="text-sm text-surface-200 mt-2 whitespace-pre-line leading-relaxed">{message}</p>
          <div className="flex gap-3 justify-end mt-6">
            <button onClick={() => close(false)}
              className="text-sm px-4 py-2 rounded-lg border border-surface-600 text-surface-200 hover:bg-surface-700 transition-colors">
              {cancelText}
            </button>
            <button onClick={() => close(true)} autoFocus
              className={`text-sm px-4 py-2 rounded-lg text-white font-medium transition-colors ${danger ? 'bg-sell hover:bg-sell/80' : 'bg-brand-500 hover:bg-brand-600'}`}>
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    );
  });
}

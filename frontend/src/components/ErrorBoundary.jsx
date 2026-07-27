import { Component } from 'react';

/**
 * Without this, ONE component throwing during render unmounts the whole tree
 * and the user just sees a white page with no clue what happened — which is
 * exactly what a broken deploy looked like. Now the error is shown on screen,
 * so a bad build is diagnosable without opening DevTools or SSH.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div className="min-h-[100dvh] bg-surface-950 flex items-center justify-center p-4">
        <div className="card p-5 sm:p-6 max-w-lg w-full">
          <h1 className="text-surface-50 font-display font-semibold text-base mb-1">Terjadi kesalahan di tampilan</h1>
          <p className="text-sm text-surface-200 mb-4">
            Data Anda aman — ini hanya kesalahan di sisi tampilan. Coba muat ulang;
            kalau tetap muncul, kemungkinan versi frontend dan backend tidak cocok.
          </p>
          <pre className="text-[11px] font-mono text-sell bg-surface-900 border border-surface-700 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
            {String(error?.message || error)}
          </pre>
          {info?.componentStack && (
            <pre className="text-[10px] font-mono text-surface-300 bg-surface-900 border border-surface-700 rounded-lg p-3 mt-2 overflow-auto max-h-32 whitespace-pre-wrap">
              {info.componentStack.trim().split('\n').slice(0, 6).join('\n')}
            </pre>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={() => window.location.reload()} className="btn-primary">Muat ulang</button>
            <button onClick={() => { try { localStorage.clear(); } catch { /* */ } window.location.reload(); }}
              className="btn-ghost">Muat ulang + bersihkan cache lokal</button>
          </div>
        </div>
      </div>
    );
  }
}

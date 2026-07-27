import { useState, useEffect } from 'react';
import { APP_VERSION } from '../version';
import { Info, AlertTriangle } from 'lucide-react';

export default function VersionInfo() {
  const [server, setServer] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    // /health sits at the root, outside the /api prefix the axios client uses.
    fetch('/health')
      .then(r => r.json())
      .then(d => setServer(d?.version || 'tidak diketahui'))
      .catch(() => setErr(true));
  }, []);

  const mismatch = server && server !== APP_VERSION;

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Info size={15} className="text-brand-300" />
        <h2 className="font-display font-semibold text-surface-50 text-sm">Versi</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-surface-300">Tampilan (browser)</p>
          <p className="text-sm font-mono text-surface-50">{APP_VERSION}</p>
        </div>
        <div className="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-surface-300">Server</p>
          <p className={`text-sm font-mono ${mismatch ? 'text-warning' : 'text-surface-50'}`}>
            {err ? 'gagal dibaca' : (server || '…')}
          </p>
        </div>
      </div>
      {mismatch && (
        <p className="flex items-start gap-1.5 text-[11px] text-warning mt-2.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          Versi tampilan dan server berbeda — build frontend belum diperbarui, atau browser masih memakai cache. Coba hard refresh; kalau tetap beda, jalankan ulang deploy.
        </p>
      )}
      <p className="text-[11px] text-surface-300 mt-2">Keduanya harus sama setelah deploy berhasil.</p>
    </div>
  );
}

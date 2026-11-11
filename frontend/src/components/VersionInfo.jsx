import { useState, useEffect } from 'react';
import { APP_VERSION } from '../version';
import { AlertTriangle } from 'lucide-react';

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
    <div className="card px-4 py-3">
      <div className="flex items-center gap-4 text-xs">
        <span className="text-surface-200">Versi</span>
        <span className="text-surface-300">tampilan <b className="font-mono text-surface-50">{APP_VERSION}</b></span>
        <span className="text-surface-300">server <b className={`font-mono ${mismatch || err ? 'text-warning' : 'text-surface-50'}`}>{err ? 'gagal dibaca' : (server || '…')}</b></span>
      </div>
      {mismatch && (
        <p className="flex items-start gap-1.5 text-[11px] text-warning mt-2">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          Versi tampilan dan server berbeda — build frontend belum diperbarui atau browser masih memakai cache. Coba hard refresh; kalau tetap beda, jalankan ulang deploy.
        </p>
      )}
    </div>
  );
}

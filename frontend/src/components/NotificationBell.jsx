import { useState, useEffect } from 'react';
import { Bell, Trash2 } from 'lucide-react';
import { getNotifs, subscribe, markAllRead, clearNotifs, unreadCount } from '../notifications';

function ago(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

const TYPE_COLOR = {
  'New order': 'text-buy', 'Order': 'text-brand-400', 'Message': 'text-brand-400',
  'Released': 'text-buy', 'Paused': 'text-warning', 'Resumed': 'text-buy', 'Error': 'text-sell',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => subscribe(() => tick(t => t + 1)), []);

  const notifs = getNotifs();
  const unread = unreadCount();

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => { const n = !o; if (n) markAllRead(); return n; })}
        title="Notifications" className="relative flex items-center justify-center w-8 h-8 rounded-md border border-surface-700 text-surface-200 hover:bg-surface-800 transition-colors">
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-sell text-white text-[9px] font-semibold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-80 max-h-[26rem] overflow-hidden flex flex-col bg-surface-800 border border-surface-700 rounded-lg shadow-xl shadow-black/50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 flex-shrink-0">
              <span className="text-sm font-semibold text-surface-50">Notifications</span>
              {notifs.length > 0 && (
                <button onClick={clearNotifs} className="flex items-center gap-1 text-xs text-surface-300 hover:text-sell transition-colors">
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>
            <div className="overflow-y-auto">
              {notifs.length === 0 ? (
                <p className="text-center text-sm text-surface-300 py-10">No notifications yet</p>
              ) : notifs.map(n => (
                <div key={n.id} className="px-3 py-2 border-b border-surface-700/50 hover:bg-surface-900/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${TYPE_COLOR[n.type] || 'text-surface-200'}`}>{n.type}</span>
                    <span className="text-[10px] text-surface-400 flex-shrink-0">{ago(n.time)}</span>
                  </div>
                  <p className="text-xs text-surface-200 mt-0.5 break-words">{n.message}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

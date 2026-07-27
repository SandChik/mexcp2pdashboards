import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Users, UserPlus, BookUser, Settings, LogOut, Zap } from 'lucide-react';
import { subscribeQueue, getQueueCount } from '../actionQueue';

const NAV = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard', short: 'Home'   },
  { to: '/queue',    icon: Zap,             label: 'Butuh aksi', short: 'Aksi', badge: true },
  { to: '/uu',       icon: Users,           label: 'Unique Users', short: 'UU'  },
  { to: '/ftd',      icon: UserPlus,        label: 'FTD',       short: 'FTD'    },
  { to: '/buyers',   icon: BookUser,        label: 'Catatan Buyer', short: 'Buyer' },
  { to: '/settings', icon: Settings,        label: 'Settings',  short: 'Setting' },
];

export default function Layout({ children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const doLogout = () => { logout(); navigate('/login'); };

  // Pending-action count, visible from every page (one shared poller).
  const [, tick] = useState(0);
  useEffect(() => subscribeQueue(() => tick(t => t + 1)), []);
  const pending = getQueueCount();

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col md:flex-row">

      {/* ── Desktop: icon rail with hover labels ─────────────────────────── */}
      <aside className="hidden md:flex w-14 border-r border-surface-700 glass flex-col items-center py-3 gap-1 flex-shrink-0">
        <div className="w-9 h-9 rounded-lg bg-grad-brand shadow-glow flex items-center justify-center mb-3">
          <span className="text-white font-bold text-base">M</span>
        </div>
        {NAV.map(({ to, icon: Icon, label, badge }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `group relative w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                isActive
                  ? 'bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/40 shadow-glow-sm'
                  : 'text-surface-300 hover:text-surface-50 hover:bg-surface-800'
              }`}>
            {({ isActive }) => (<>
              <Icon size={18} />
              {badge && pending > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-brand-500 text-white text-[9px] font-semibold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center shadow-glow-sm">
                  {pending > 99 ? '99+' : pending}
                </span>
              )}
              {isActive && <span className="absolute -left-[7px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-brand-400 shadow-glow-sm" />}
              {/* Label on hover — recognition instead of guessing what the icon means */}
              <span className="pointer-events-none absolute left-12 z-50 whitespace-nowrap rounded-md bg-surface-800 border border-surface-700 px-2 py-1 text-xs text-surface-50
                               opacity-0 group-hover:opacity-100 transition-opacity shadow-lift">{label}</span>
            </>)}
          </NavLink>
        ))}
        <div className="flex-1" />
        <button onClick={doLogout} title="Log out"
          className="group relative w-10 h-10 rounded-lg flex items-center justify-center text-surface-300 hover:text-sell hover:bg-sell/10 transition-colors">
          <LogOut size={18} />
          <span className="pointer-events-none absolute left-12 z-50 whitespace-nowrap rounded-md bg-surface-800 border border-surface-700 px-2 py-1 text-xs text-surface-50
                           opacity-0 group-hover:opacity-100 transition-opacity">Log out</span>
        </button>
      </aside>

      {/* Content. On mobile the bottom bar overlays, so reserve room for it. */}
      <main className="flex-1 min-w-0 overflow-hidden pb-[60px] md:pb-0">{children}</main>

      {/* ── Mobile: bottom tab bar, labelled, thumb-reachable ────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass border-t pb-safe">
        <div className="flex items-stretch">
          {NAV.map(({ to, icon: Icon, short, badge }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-brand-300' : 'text-surface-300'
                }`}>
              {({ isActive }) => (<>
                <span className={`relative flex items-center justify-center w-9 h-6 rounded-md transition-all ${isActive ? 'bg-brand-500/15 shadow-glow-sm' : ''}`}>
                  <Icon size={17} />
                  {badge && pending > 0 && (
                    <span className="absolute -top-1 right-0.5 bg-brand-500 text-white text-[9px] font-semibold rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center">
                      {pending > 9 ? '9+' : pending}
                    </span>
                  )}
                </span>
                {short}
              </>)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

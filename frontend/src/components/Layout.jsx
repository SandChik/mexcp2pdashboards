import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Users, UserPlus, BookUser, Settings, LogOut } from 'lucide-react';

export default function Layout({ children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const nav = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/uu', icon: Users, label: 'Unique Users' },
    { to: '/ftd', icon: UserPlus, label: 'FTD' },
    { to: '/buyers', icon: BookUser, label: 'Catatan Buyer' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];
  return (
    <div className="min-h-screen bg-surface-950 flex">
      <aside className="w-14 border-r border-surface-700 bg-black/40 backdrop-blur-sm flex flex-col items-center py-3 gap-1">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow flex items-center justify-center mb-3">
          <span className="text-white font-bold text-base">M</span>
        </div>
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} title={label}
            className={({ isActive }) =>
              `w-10 h-10 rounded-md flex items-center justify-center transition-all ${
                isActive
                  ? 'bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/40 shadow-glow-sm'
                  : 'text-surface-300 hover:text-surface-50 hover:bg-surface-800'
              }`}>
            <Icon size={18} />
          </NavLink>
        ))}
        <div className="flex-1" />
        <button onClick={() => { logout(); navigate('/login'); }} title="Log out"
          className="w-10 h-10 rounded-md flex items-center justify-center text-surface-300 hover:text-sell hover:bg-sell/10 transition-colors">
          <LogOut size={18} />
        </button>
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

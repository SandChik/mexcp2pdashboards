import { useState, useEffect, Fragment } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, BookUser, Settings, LogOut, Zap } from 'lucide-react';
import { subscribeQueue, getActionableCount } from '../actionQueue';

// Floating dock (v81) — replaces the left icon rail on desktop and the edge-to-
// edge tab bar on phones. Pages size themselves with `.page-h` (100dvh minus
// --dock-space, see index.css), so the dock gets its own lane and never covers
// a panel's last row.

const NAV_GROUPS = [
  [
    { to: '/',      logo: '/brand/mexc.png',  label: 'Dashboard MEXC',  short: 'MEXC' },
    { to: '/bingx', logo: '/brand/bingx.png', label: 'Dashboard BingX', short: 'BingX' },
    { to: '/gate',  logo: '/brand/gate.svg',  label: 'Dashboard Gate',  short: 'Gate' },
  ],
  [
    { to: '/queue',  icon: Zap,      label: 'Antrian',       short: 'Antrian', badge: true },
    { to: '/uu',     icon: Users,    label: 'Unique Users',  short: 'UU' },
    { to: '/ftd',    icon: UserPlus, label: 'FTD',           short: 'FTD' },
    { to: '/buyers', icon: BookUser, label: 'Catatan Buyer', short: 'Buyer' },
  ],
  [
    { to: '/settings', icon: Settings, label: 'Settings', short: 'Setting' },
  ],
];

function Tile({ item, size }) {
  const { logo, icon: Icon, label } = item;
  if (logo) return <img src={logo} alt={label} className="dock-tile bg-white object-contain" style={{ width: size, height: size }} />;
  return (
    <span className="dock-tile dock-tile-glyph" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.46)} strokeWidth={1.9} />
    </span>
  );
}

function Badge({ n, cap }) {
  if (!(n > 0)) return null;
  return (
    <span className="absolute -top-1 -right-1 z-10 bg-sell text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center ring-2 ring-black/70">
      {n > cap ? `${cap}+` : n}
    </span>
  );
}

export default function Layout({ children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const doLogout = () => { logout(); navigate('/login'); };

  // Pending-action count, visible from every page (one shared poller).
  const [, tick] = useState(0);
  useEffect(() => subscribeQueue(() => tick(t => t + 1)), []);
  // Deliberately NOT the full running-order count: the badge answers "is there
  // work for me right now", and orders merely waiting on the counterpart are not.
  const pending = getActionableCount();

  return (
    <div className="min-h-[100dvh]">
      <main className="min-w-0 overflow-hidden">{children}</main>

      {/* ── Desktop: macOS-style dock, magnifies on hover ─────────────────── */}
      <nav aria-label="Menu utama" className="dock hidden md:flex fixed bottom-3 left-1/2 -translate-x-1/2 z-40 items-end gap-1 px-2 pt-2 pb-1.5">
        {NAV_GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <span aria-hidden className="w-px self-stretch my-1 mx-1.5 bg-white/10" />}
            {group.map(item => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} aria-label={item.label} className="dock-item group">
                {({ isActive }) => (<>
                  <span className="relative block">
                    <Tile item={item} size={44} />
                    {item.badge && <Badge n={pending} cap={99} />}
                  </span>
                  <span className={`block mx-auto mt-1 w-1 h-1 rounded-full transition-opacity ${isActive ? 'bg-surface-50 opacity-90' : 'opacity-0'}`} />
                  <span className="dock-tip">{item.label}</span>
                </>)}
              </NavLink>
            ))}
          </Fragment>
        ))}
        <span aria-hidden className="w-px self-stretch my-1 mx-1.5 bg-white/10" />
        <button onClick={doLogout} aria-label="Keluar" className="dock-item group">
          <span className="dock-tile dock-tile-glyph hover:!text-sell" style={{ width: 44, height: 44 }}><LogOut size={19} strokeWidth={1.9} /></span>
          <span className="block mx-auto mt-1 w-1 h-1 opacity-0" />
          <span className="dock-tip">Keluar</span>
        </button>
      </nav>

      {/* ── Phone: the same dock, floating, labelled for the thumb ───────── */}
      <nav aria-label="Menu utama" className="dock md:hidden fixed inset-x-2 bottom-[calc(8px+env(safe-area-inset-bottom))] z-40 flex px-1 pt-1.5 pb-2">
        {NAV_GROUPS.flat().map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}
            className="flex-1 min-w-0 flex flex-col items-center gap-1">
            {({ isActive }) => (<>
              <span className={`relative rounded-[11px] transition-all ${isActive ? 'ring-2 ring-brand-400/80 ring-offset-2 ring-offset-black/60' : ''}`}>
                <Tile item={item} size={32} />
                {item.badge && <Badge n={pending} cap={9} />}
              </span>
              <span className={`text-[10px] leading-tight font-medium truncate max-w-full ${isActive ? 'text-surface-50' : 'text-surface-300'}`}>{item.short}</span>
            </>)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

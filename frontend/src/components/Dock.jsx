import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, BookUser, Settings, LogOut, Zap } from 'lucide-react';
import { subscribeQueue, getActionableCount } from '../actionQueue';

// Floating dock (v81, reworked v82). Rendered ONCE by App, outside the pages,
// so it survives navigation: the phone highlight can slide from the old item
// to the new one, and the desktop magnification never resets mid-hover.
// Pages size themselves with `.page-h` (100dvh − --dock-space, index.css).

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
const ITEMS = NAV_GROUPS.flat();
const isActive = (to, path) => (to === '/' ? path === '/' : path === to || path.startsWith(to + '/'));

function Tile({ item }) {
  const { logo, icon: Icon, label } = item;
  if (logo) return <img src={logo} alt={label} draggable={false} className="dock-tile bg-white object-contain" />;
  return <span className="dock-tile dock-tile-glyph"><Icon strokeWidth={1.9} /></span>;
}

function Badge({ n, cap }) {
  if (!(n > 0)) return null;
  return (
    <span className="absolute -top-1 -right-1 z-10 bg-sell text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center ring-2 ring-surface-800">
      {n > cap ? `${cap}+` : n}
    </span>
  );
}

// ── Desktop: true macOS magnification ────────────────────────────────
// Each slot's WIDTH follows the cursor's distance (cosine falloff), so a
// magnified icon pushes its neighbours aside instead of overlapping them.
const BASE = 44;     // px, resting icon size
const PEAK = 68;     // px, icon right under the cursor
const RANGE = 140;   // px, how far the swell reaches either side

function DesktopDock({ pending, onLogout }) {
  const slots = useRef([]);
  const mouseX = useRef(null);
  const frame = useRef(0);
  const { pathname } = useLocation();

  const apply = useCallback(() => {
    frame.current = 0;
    const x = mouseX.current;
    for (const el of slots.current) {
      if (!el) continue;
      let s = BASE;
      if (x !== null) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(x - (r.left + r.width / 2));
        if (d < RANGE) s = BASE + (PEAK - BASE) * Math.cos((d / RANGE) * (Math.PI / 2));
      }
      el.style.setProperty('--s', `${s.toFixed(1)}px`);
    }
  }, []);
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(apply); };
  const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onMove = (e) => { if (reduced()) return; mouseX.current = e.clientX; schedule(); };
  const onLeave = () => { mouseX.current = null; schedule(); };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  let k = 0; // slot index across groups (logout included)
  const sep = <span aria-hidden className="w-px h-9 self-center mx-1 bg-surface-700" />;

  return (
    <nav aria-label="Menu utama" onMouseMove={onMove} onMouseLeave={onLeave}
      className="dock hidden md:flex fixed bottom-3 left-1/2 -translate-x-1/2 z-40 items-end gap-2 px-2.5 pt-2.5 pb-1.5">
      {NAV_GROUPS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && sep}
          {group.map(item => {
            const i = k++;
            const on = isActive(item.to, pathname);
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} aria-label={item.label} className="dock-item">
                <span ref={el => { slots.current[i] = el; }} className="dock-slot">
                  <span className="dock-lift">
                    <Tile item={item} />
                    {item.badge && <Badge n={pending} cap={99} />}
                  </span>
                  <span className="dock-tip">{item.label}</span>
                </span>
                <span className={`dock-dot ${on ? 'opacity-90' : 'opacity-0'}`} />
              </NavLink>
            );
          })}
        </Fragment>
      ))}
      {sep}
      <button onClick={onLogout} aria-label="Keluar" className="dock-item">
        <span ref={el => { slots.current[k] = el; }} className="dock-slot">
          <span className="dock-lift"><span className="dock-tile dock-tile-glyph dock-tile-danger"><LogOut strokeWidth={1.9} /></span></span>
          <span className="dock-tip">Keluar</span>
        </span>
        <span className="dock-dot opacity-0" />
      </button>
    </nav>
  );
}

// ── Phone: labelled dock with a glass highlight that slides to the active item ──
function MobileDock({ pending }) {
  const { pathname } = useLocation();
  const routeIdx = ITEMS.findIndex(i => isActive(i.to, pathname));
  // v83: the highlight follows the TAP, not the route. The route only changes
  // once the new page has rendered (a heavy dashboard takes 100 ms+ on a
  // phone); waiting for it made the slide stall and then jump.
  const [tapIdx, setTapIdx] = useState(null);
  useEffect(() => { setTapIdx(null); }, [pathname]);
  const idx = tapIdx ?? routeIdx;
  const n = ITEMS.length;

  return (
    <nav aria-label="Menu utama" className="dock dock-solid md:hidden fixed inset-x-2 bottom-[var(--dock-bottom)] z-40 p-1.5">
      <div className="relative flex">
        {idx >= 0 && (
          <span aria-hidden className="dock-pill" style={{ width: `${100 / n}%`, transform: `translateX(${idx * 100}%)` }} />
        )}
        {ITEMS.map((item, i) => {
          const on = i === idx;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} aria-label={item.label}
              onClick={() => setTapIdx(i)}
              className="relative z-10 flex-1 min-w-0 flex flex-col items-center gap-1 pt-1.5 pb-1">
              {/* v85: the icon itself never moves or scales. The old press-shrink
                  plus a bouncy "pop" changed direction 2–3 times per tap and read
                  as a shiver; the sliding highlight is the whole effect now. */}
              <span className="relative w-8 h-8">
                {/* Only the icon dims when inactive — the badge stays loud */}
                <span className={`block w-full h-full transition-opacity duration-200 ${on ? '' : 'opacity-55'}`}>
                  <Tile item={item} />
                </span>
                {item.badge && <Badge n={pending} cap={9} />}
              </span>
              {/* Same weight in both states: a bolder label would re-layout mid-animation */}
              <span className={`text-[10px] leading-tight font-semibold truncate max-w-full transition-colors duration-200 ${
                on ? 'text-brand-300' : 'text-surface-200'}`}>{item.short}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export default function Dock() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  // Pending-action count, visible from every page (one shared poller).
  const [, tick] = useState(0);
  useEffect(() => subscribeQueue(() => tick(t => t + 1)), []);
  // Deliberately NOT the full running-order count: the badge answers "is there
  // work for me right now", and orders merely waiting on the counterpart are not.
  const pending = getActionableCount();

  return (<>
    <DesktopDock pending={pending} onLogout={() => { logout(); navigate('/login'); }} />
    <MobileDock pending={pending} />
  </>);
}

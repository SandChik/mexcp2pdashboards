// Lightweight notification history store (persists in this browser).
const KEY = 'mexc_notifs';
let listeners = [];
let items = load();

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* */ } }
function emit() { listeners.forEach(fn => fn()); }

export function getNotifs() { return items; }
export function unreadCount() { return items.filter(n => !n.read).length; }
export function addNotif(type, message) {
  const n = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, message, time: Date.now(), read: false };
  items = [n, ...items].slice(0, 100);
  save(); emit();
}
export function markAllRead() { items = items.map(n => ({ ...n, read: true })); save(); emit(); }
export function clearNotifs() { items = []; save(); emit(); }
export function subscribe(fn) { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; }

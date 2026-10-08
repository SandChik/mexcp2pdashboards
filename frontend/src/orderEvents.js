import toast from 'react-hot-toast';
import { playSound, soundForState } from './sounds';
import { shouldAnnounce } from './announce';
import { ORDER_STATES } from './components/helpers';

/**
 * One place that decides "this order changed — say something".
 *
 * Two things call it: the merchant panels on the dashboard, and the app-wide
 * queue poller. Before this existed only the panels did, which meant sitting on
 * the Antrian page (or any page other than the dashboard) was completely
 * silent — the exact page you sit on while waiting for orders.
 *
 * Double-announcing is prevented by shouldAnnounce(), not by only having one
 * caller: both use the same event ids, so whichever poller sees a change first
 * claims it and the other stays quiet. That also holds across browser tabs.
 */

const RUNNING = [0, 1, 2, 3, 9, 10]; // 9 = Banding (BingX appeal), 10 = unknown BingX status — both unresolved

/**
 * @param opts.merchantId    used in the event id — keeps merchants independent
 * @param opts.merchantName  shown in the "order baru" toast
 * @param opts.orders        normalized orders (need advOrderNo, _state, unreadCount)
 * @param opts.prevStates    { advOrderNo: state } from the previous cycle
 * @param opts.prevUnread    { advOrderNo: unreadCount } from the previous cycle
 * @param opts.first         true on the first cycle — record only, never announce,
 *                           otherwise opening the app screams about old orders
 * @returns { states, unread } to store for the next cycle
 */
export function announceOrderChanges({ merchantId, merchantName, orders, prevStates = {}, prevUnread = {}, first = false }) {
  const states = {}, unread = {};
  orders.forEach(o => { states[o.advOrderNo] = o._state; unread[o.advOrderNo] = o.unreadCount || 0; });
  if (first) return { states, unread };

  let nowActive = 0, wasActive = 0;

  orders.forEach(o => {
    const ps = prevStates[o.advOrderNo];
    const pu = prevUnread[o.advOrderNo];

    if (ps !== undefined && ps !== o._state
        && shouldAnnounce(`st:${merchantId}:${o.advOrderNo}:${o._state}`)) {
      const ev = soundForState(o._state);
      if (ev) playSound(ev);
      toast(`${o.userInfo?.nickName || 'Order'}: ${ORDER_STATES[ps]?.label || ps} → ${ORDER_STATES[o._state]?.label || o._state}`, { duration: 5000 });
    }

    if (pu !== undefined && (o.unreadCount || 0) > pu
        && shouldAnnounce(`msg:${merchantId}:${o.advOrderNo}:${o.unreadCount}`)) {
      playSound('message');
      toast(`${o.userInfo?.nickName || 'Buyer'}: pesan baru`, { duration: 3000 });
    }

    if (RUNNING.includes(o._state)) nowActive++;
  });

  Object.values(prevStates).forEach(s => { if (RUNNING.includes(s)) wasActive++; });
  if (nowActive > wasActive && shouldAnnounce(`new:${merchantId}:${nowActive}`, 8000)) {
    playSound('newOrder');
    toast.success(`Order baru — ${merchantName}`, { duration: 4000 });
  }

  // MEXC appeals are a flag (`complaining`), not a state: alert the first time
  // an order is seen with it, once per order per session.
  orders.forEach(o => {
    if (o.complaining === true && shouldAnnounce(`appeal:${merchantId}:${o.advOrderNo}`, 24 * 3600 * 1000)) {
      playSound('duplicate');
      toast.error(`⚠ BANDING — ${merchantName}: ${o.userInfo?.nickName || o.advOrderNo}`, { duration: 8000 });
    }
  });

  // Any difference between this cycle and the last one — state, unread, count
  // — is broadcast so the app-wide queue re-reads immediately instead of at
  // its own next tick. The panels poll every 5s; before this the queue could
  // lag them by a full extra interval, which is exactly what "the panel already
  // beeped but Antrian is still empty" looks like.
  const changed = orders.some(o => prevStates[o.advOrderNo] !== o._state || (prevUnread[o.advOrderNo] ?? 0) !== (o.unreadCount || 0))
    || Object.keys(prevStates).length !== orders.length;
  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('p2p:orders-changed', { detail: { merchantId } }));
  }

  return { states, unread };
}

/**
 * Alert for a KYC name that has ordered before.
 *
 * Fires once per order (long TTL) rather than once per poll — the same repeat
 * buyer sitting in the queue for ten minutes should not sound every 15 seconds.
 */
export function announceDuplicate({ merchantId, advOrderNo, realName, times }) {
  if (!shouldAnnounce(`dup:${merchantId}:${advOrderNo}`, 3600000)) return;
  playSound('duplicate');
  toast(`${realName}: sudah pernah order (${times}x)`, { duration: 6000, icon: '⚠️' });
}

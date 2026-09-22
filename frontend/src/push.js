import { notifyApi } from './api';

/**
 * Web Push on the browser side.
 *
 * Requirements the code cannot work around:
 *   - HTTPS (or localhost): service workers refuse to register on http://.
 *   - iPhone/iPad: only when the dashboard is opened from the Home Screen
 *     (Share → Add to Home Screen), iOS 16.4+. In Safari itself: never.
 *   - The user must grant permission from a click, not on page load.
 */
export function pushSupport() {
  const secure = typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost');
  const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const pm = typeof window !== 'undefined' && 'PushManager' in window;
  const notif = typeof window !== 'undefined' && 'Notification' in window;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  const reasons = [];
  if (!secure) reasons.push('alamat bukan HTTPS — service worker tidak bisa didaftarkan');
  if (!sw || !pm || !notif) reasons.push(ios && !standalone ? 'iPhone: tambahkan dulu ke Home Screen (Bagikan → Add to Home Screen), lalu buka dari sana' : 'browser ini tidak mendukung Web Push');
  return { ok: reasons.length === 0, secure, ios, standalone, reasons, permission: notif ? Notification.permission : 'unsupported' };
}

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentSubscription() {
  try { const reg = await navigator.serviceWorker.getRegistration('/'); return reg ? await reg.pushManager.getSubscription() : null; }
  catch { return null; }
}

/** Ask permission (must be called from a click) and subscribe this device. */
export async function enablePush(label = '') {
  const sup = pushSupport();
  if (!sup.ok) throw new Error(sup.reasons.join('; '));
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Izin notifikasi DITOLAK di browser — buka setelan situs dan izinkan, lalu coba lagi' : 'Izin notifikasi belum diberikan');
  const reg = await registerSW();
  await navigator.serviceWorker.ready;
  const { data } = await notifyApi.status();
  if (!data.publicKey) throw new Error('Server belum punya kunci Web Push (paket web-push belum terpasang?)');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(data.publicKey) });
  await notifyApi.subscribe(sub.toJSON(), label);
  localStorage.setItem('push-enabled', '1');
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) { try { await notifyApi.unsubscribe(sub.endpoint); } catch { /* ignore */ } await sub.unsubscribe(); }
  localStorage.removeItem('push-enabled');
}

/** On app start: keep the SW alive if this device opted in earlier. */
export async function resumePush() {
  if (localStorage.getItem('push-enabled') !== '1') return;
  if (!pushSupport().ok) return;
  try { await registerSW(); } catch { /* ignore */ }
}

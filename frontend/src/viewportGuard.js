// iOS Home-Screen app: un-stick a shrunken viewport (v85, widened v86).
//
// The bug (WebKit, iOS 17 → 26, standalone web apps only): after the keyboard
// closes, or when the app comes back from the background, iOS sometimes leaves
// the web view's viewport short by the status-bar height (≈59 px on
// Dynamic-Island iPhones). innerHeight, 100dvh and every `position: fixed;
// bottom` element follow it, so the dock floats ~59 px too high over a black
// band — and it stays that way until the app is force-quit.
//
// What brings it back: a size change of the full-height app shell makes WebKit
// measure the viewport again. So when the height is stuck below what this
// screen is known to have, hide #root and show it again inside ONE synchronous
// task (no frame is painted in between, nothing flashes) and put every scroll
// position back. From the second try on, also re-apply the viewport <meta>
// (a second, independent way to make WebKit rebuild its viewport). Runs only in
// the iOS standalone app, only when the height is actually short, never while
// someone is typing, and backs off if it does not help — so a healthy app
// never flips at all.

const SLACK = 4;                        // px of noise we ignore
const RETRY_MS = [0, 3000, 15000];      // tries per stuck size, then give up until the size changes

const state = { installed: false, reason: '', tries: 0, lastTry: null, lastResult: '' };
/** What the guard has seen and done — shown by the "Cek layar" tool in Settings. */
export function viewportGuardState() { return { ...state }; }

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  // navigator.standalone is the classic iOS flag; the media query is the
  // standard one and still answers if a future iOS drops the flag.
  if (navigator.standalone === true) return true;
  try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch { return false; }
}

export function installViewportGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isIOS()) { state.reason = 'bukan iOS'; return; }
  if (!isStandalone()) { state.reason = 'bukan mode Home Screen'; return; }
  const root = document.getElementById('root');
  if (!root) { state.reason = 'tanpa #root'; return; }
  state.installed = true; state.reason = 'aktif';

  const peaks = new Map();   // innerWidth → tallest innerHeight seen at that width
  const scrollers = new Set();
  let stuck = null;          // { key, tries, at } for the size we are trying to fix
  let flipping = false;
  let timer = 0;

  // Scroll events don't bubble, but a capturing listener sees every one: this
  // is how we know which inner panels have a scroll position worth restoring.
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    if (t && t.nodeType === 1) scrollers.add(t);
  }, { capture: true, passive: true });

  const typing = () => {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  };

  // The height this width should have: the tallest seen so far and — in case
  // the app was already stuck when it started — the screen itself (iOS keeps
  // screen.width/height in portrait terms, whatever the orientation).
  const expected = (w) => {
    let e = peaks.get(w) || 0;
    const sw = window.screen && window.screen.width, sh = window.screen && window.screen.height;
    if (w === sw) e = Math.max(e, sh);
    else if (w === sh) e = Math.max(e, sw);
    return e;
  };

  const note = () => {
    const w = window.innerWidth, h = window.innerHeight;
    if (h > (peaks.get(w) || 0)) peaks.set(w, h);
  };

  function reapplyViewportMeta() {
    const m = document.querySelector('meta[name="viewport"]');
    if (!m) return;
    const c = m.getAttribute('content') || '';
    m.setAttribute('content', `${c}, height=device-height`);
    void root.offsetHeight;
    m.setAttribute('content', c);
  }

  function flip(withMeta) {
    flipping = true;
    const saved = [];
    for (const el of scrollers) {
      if (!el.isConnected) { scrollers.delete(el); continue; }
      if (el.scrollTop || el.scrollLeft) saved.push([el, el.scrollTop, el.scrollLeft]);
    }
    const wx = window.scrollX, wy = window.scrollY;
    const prev = root.style.display;
    try {
      root.style.display = 'none';
      void root.offsetHeight;          // forced synchronous layout with an empty document
      if (withMeta) reapplyViewportMeta();
      root.style.display = prev;
      void root.offsetHeight;          // and again with the app back
      for (const [el, top, left] of saved) { el.scrollTop = top; el.scrollLeft = left; }
      if (wx || wy) window.scrollTo(wx, wy);
    } finally {
      root.style.display = prev;
      flipping = false;
    }
  }

  function check() {
    timer = 0;
    if (flipping || document.visibilityState !== 'visible' || typing()) return;
    note();
    const w = window.innerWidth, h = window.innerHeight;
    if (expected(w) - h <= SLACK) {
      if (stuck) state.lastResult = `pulih (${h}px)`;
      stuck = null;
      return;
    }

    const key = `${w}x${h}`;
    if (!stuck || stuck.key !== key) stuck = { key, tries: 0, at: 0 };
    if (stuck.tries >= RETRY_MS.length) return;                 // gave up for this size
    if (Date.now() - stuck.at < RETRY_MS[stuck.tries]) return;  // backing off
    stuck.tries += 1; stuck.at = Date.now();
    flip(stuck.tries > 1);
    note();                       // WebKit may already report the real height
    state.tries += 1;
    state.lastTry = new Date().toLocaleTimeString('id-ID');
    state.lastResult = `tinggi ${h}px, seharusnya ${expected(w)}px → sesudah ${window.innerHeight}px (percobaan ${stuck.tries}/${RETRY_MS.length})`;
    // A later `resize` (the usual way the fix arrives) re-runs check().
  }

  const schedule = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(check, ms);
  };

  note();
  // Keyboard closed (focus left a field): give the keyboard time to slide away.
  document.addEventListener('focusout', () => { if (!flipping) schedule(350); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(400); });
  window.addEventListener('pageshow', () => schedule(400));
  window.addEventListener('resize', () => schedule(250));
  window.addEventListener('orientationchange', () => schedule(600));
  // Safety net for the "after a while in the background" variant: reading two
  // numbers every 2 s costs nothing, and it only ever acts when the height is short.
  setInterval(() => { if (!timer) check(); }, 2000);
  schedule(800);                  // the app may already be stuck when it starts
}

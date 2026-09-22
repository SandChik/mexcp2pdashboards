import toast from 'react-hot-toast';

/**
 * Copy text to the clipboard from ANY context, and always say what happened.
 *
 * navigator.clipboard only exists on HTTPS or localhost. The dashboard is
 * usually opened over plain HTTP (Tailscale IP / LAN), where that object is
 * undefined — the old one-liners threw before their toast ran, which is why
 * copying "did nothing, no notification". Order: modern API when available,
 * else the hidden-textarea + execCommand path that works on http://, iOS
 * Safari and old Android WebViews.
 *
 * Returns true on success. Always toasts unless { silent: true }.
 */
export async function copyToClipboard(value, label = 'Teks', opts = {}) {
  const text = String(value ?? '');
  const say = (ok, why) => {
    if (opts.silent) return;
    if (ok) toast.success(`${label} disalin`, { duration: 1400 });
    else toast.error(`Gagal menyalin ${label.toLowerCase()}${why ? ` — ${why}` : ''}`, { duration: 2500 });
  };
  if (!text) { say(false, 'kosong'); return false; }

  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); say(true); return true; }
    catch { /* fall through to the legacy path */ }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px'; // iOS: avoid zoom on focus
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS Safari ignores select() alone
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    say(!!ok, ok ? '' : 'browser menolak');
    return !!ok;
  } catch (e) {
    say(false, e?.message);
    return false;
  }
}

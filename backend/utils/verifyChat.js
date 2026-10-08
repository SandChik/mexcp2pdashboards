/**
 * MEXC "extra verification" (overVerify) lives in the CHAT, not in the order
 * state (v77 — observed live 8 Oct 2026). The order stays NOT_PAID the whole
 * time; MEXC drops system messages into the conversation instead:
 *
 *   {"ext":{"operator":"…","operatorMsgKey":"OVER_VERIFY_SEND_FILE_TIP",…},"exchange":false}
 *     → the buyer uploaded a document, the merchant must approve/reject in the app
 *   {"ext":{…,"operatorMsgKey":"OVER_VERIFY_PASS_TIP",…}}   → approved, buyer may pay
 *   {"ext":{…,"operatorMsgKey":"OVER_VERIFY_FAIL_TIP",…}}   → rejected (order then CANCELs)
 *
 * These are what the auto-reply worker and the notifier key off. Anything else
 * under OVER_VERIFY_* is reported as `kind: 'other'` with its key, so a new
 * variant shows up in the Settings diagnostics instead of silently doing nothing.
 */
const KINDS = {
  OVER_VERIFY_SEND_FILE_TIP: 'file',
  OVER_VERIFY_PASS_TIP: 'pass',
  OVER_VERIFY_FAIL_TIP: 'fail',
};
// Pseudo-states used by auto-reply rules (negative so they can never collide
// with a real OrderDealState).
const RULE_STATE = { file: -3, pass: -2, fail: -4 };

/** Parse one chat message. Returns { key, kind } for a system message, else null. */
function parseSystem(m) {
  const c = m && m.content;
  if (typeof c !== 'string' || c[0] !== '{' || !c.includes('operatorMsgKey')) return null;
  try {
    const j = JSON.parse(c);
    const key = j && j.ext && j.ext.operatorMsgKey;
    if (!key) return null;
    const kind = KINDS[key] || (String(key).startsWith('OVER_VERIFY_') ? 'other' : null);
    return kind ? { key: String(key), kind } : null;
  } catch { return null; }
}

/** All verification events in a message list, oldest first. */
function eventsOf(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const s = parseSystem(m);
    if (s) out.push({ ...s, id: m.id != null ? String(m.id) : null, createTime: Number(m.createTime) || 0 });
  }
  return out.sort((a, b) => a.createTime - b.createTime);
}

/** Human line for the chat UI. */
const LABELS = {
  file: 'Buyer mengirim dokumen verifikasi — setujui/tolak di app MEXC',
  pass: 'Verifikasi diterima — buyer boleh bayar',
  fail: 'Verifikasi ditolak',
};

module.exports = { KINDS, RULE_STATE, LABELS, parseSystem, eventsOf };

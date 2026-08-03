import { ordersApi } from './api';
import { askConfirm } from './components/confirm';
import { formatAmount, normalizeState, ORDER_STATES, getBankName } from './components/helpers';
import toast from 'react-hot-toast';

/**
 * One source of truth for "what can I do with this order right now".
 *
 * IMPORTANT — the two MEXC endpoints disagree about whose perspective `side`
 * describes, confirmed against live data:
 *
 *   LIST   (/fiat/market/order/pagination) → OUR perspective.
 *          SELL = we sell USDT  → we RELEASE once the buyer pays.
 *          BUY  = we buy USDT   → we CONFIRM we paid.
 *
 *   DETAIL (/fiat/order/detail)            → the COUNTERPART's perspective,
 *          i.e. exactly inverted. OrderDetailModal keeps its own (proven)
 *          check for that shape; everything here is list-shaped.
 *
 * Getting this backwards puts a Release button on the wrong order, so every
 * action ALSO re-verifies against the detail endpoint before firing.
 */
const ACTIVE_RELEASE = [1, 2, 3]; // buyer paid / processing → we release
const ACTIVE_CONFIRM = [0, 2, 3]; // we still need to mark our payment

export function canRelease(order) {
  return order?.side === 'SELL' && ACTIVE_RELEASE.includes(normalizeState(order.state ?? order._state));
}
export function canConfirmPaid(order) {
  return order?.side === 'BUY' && ACTIVE_CONFIRM.includes(normalizeState(order.state ?? order._state));
}
export function actionFor(order) {
  if (canRelease(order)) return 'release';
  if (canConfirmPaid(order)) return 'confirm';
  return null;
}

/**
 * Safety net: confirm with the detail endpoint that this order really is in a
 * releasable / confirmable state before touching money. One extra request,
 * and it makes an inverted-convention bug impossible to act on — the worst
 * case becomes a refusal instead of a wrong operation.
 * Returns { ok, detail, reason }.
 */
async function verifyWithDetail(merchantId, advOrderNo, intent) {
  try {
    const d = await ordersApi.detail(merchantId, advOrderNo);
    const data = d.data?.data || d.data || {};
    if (!data.side) return { ok: true, detail: data }; // nothing to check against
    const st = normalizeState(data.state);
    // Detail speaks the counterpart's language: BUY = they buy = we release.
    const okRelease = data.side === 'BUY'  && ACTIVE_RELEASE.includes(st);
    const okConfirm = data.side === 'SELL' && ACTIVE_CONFIRM.includes(st);
    if (intent === 'release' && okRelease) return { ok: true, detail: data };
    if (intent === 'confirm' && okConfirm) return { ok: true, detail: data };
    return { ok: false, detail: data, reason: `Status order sudah berubah (${ORDER_STATES[st]?.label || st}). Buka detail untuk mengecek.` };
  } catch {
    return { ok: false, reason: 'Tidak bisa memverifikasi order ke MEXC. Coba lagi.' };
  }
}

/**
 * Release coin. The confirmation dialog is NOT optional — releasing is
 * irreversible, so the amount and counterpart are always shown first.
 * Returns true on success.
 */
export async function releaseOrder(merchantId, order, { skipConfirm = false } = {}) {
  const qty = `${formatAmount(order.tradableQuantity, 8)} ${order.coinName || 'USDT'}`;
  const amt = `${formatAmount(order.amount, 0)} ${order.fiatUnit || ''}`;
  const nick = order.userInfo?.nickName || 'buyer';

  // Verify BEFORE asking, so the dialog can show the buyer's KYC name — that is
  // the name you match against the sender on your bank statement, and it only
  // exists on the detail payload.
  const v = await verifyWithDetail(merchantId, order.advOrderNo, 'release');
  if (!v.ok) { toast.error(v.reason); return false; }
  const realName = v.detail?.userInfo?.realName || null;
  const pay = v.detail?.confirmPaymentInfo || v.detail?.paymentInfo?.[0] || null;

  if (!skipConfirm) {
    const lines = [
      realName ? `Nama KYC : ${realName}` : null,
      `Nickname : ${nick}`,
      `Dia bayar: ${amt}`,
      pay ? `Bank     : ${getBankName(pay.payMethod)}` : null,
      pay?.account ? `No. rek. : ${pay.account}` : null,
      pay?.payee ? `A/N      : ${pay.payee}` : null,
      '',
      'Pastikan dana SUDAH benar-benar masuk ke rekening Anda dan nama pengirim cocok. Aksi ini tidak bisa dibatalkan.',
    ].filter(l => l !== null);
    const ok = await askConfirm({
      title: `Release ${qty}?`,
      message: lines.join('\n'),
      confirmText: 'Release coin',
      danger: true,
    });
    if (!ok) return false;
  }

  try {
    const r = await ordersApi.releaseCoin(merchantId, order.advOrderNo);
    if (r.data?.code === 0) {
      toast.success(`Coin dilepas — ${amt}`);
      return true;
    }
    toast.error('Gagal: ' + (r.data?.msg || 'Error'));
  } catch (e) {
    toast.error(e.response?.data?.error || e.message);
  }
  return false;
}

/**
 * Confirm payment. The payment-method id only exists on the order DETAIL
 * response, so we fetch it on demand — still one round trip instead of
 * opening the whole modal.
 */
export async function confirmPaidOrder(merchantId, order, { skipConfirm = false } = {}) {
  const amt = `${formatAmount(order.amount, 0)} ${order.fiatUnit || ''}`;
  const who = order.userInfo?.nickName || 'penjual';

  if (!skipConfirm) {
    const ok = await askConfirm({
      title: 'Tandai sudah bayar?',
      message: `Ke: ${who}\nNominal: ${amt}\n\nPastikan transfer Anda benar-benar sudah terkirim.`,
      confirmText: 'Tandai sudah bayar',
    });
    if (!ok) return false;
  }

  try {
    const v = await verifyWithDetail(merchantId, order.advOrderNo, 'confirm');
    if (!v.ok) { toast.error(v.reason); return false; }
    const data = v.detail || {};
    const payId = data.confirmPaymentInfo?.id || data.paymentInfo?.[0]?.id
      || order.confirmPaymentInfo?.id || order.paymentInfo?.[0]?.id || null;
    if (!payId) {
      toast.error('Metode bayar tidak ditemukan — buka detail order untuk pilih manual.');
      return false;
    }
    const r = await ordersApi.confirmPaid(merchantId, order.advOrderNo, parseInt(payId));
    if (r.data?.code === 0) {
      toast.success(`Pembayaran dikonfirmasi — ${amt}`);
      return true;
    }
    toast.error('Gagal: ' + (r.data?.msg || 'Error'));
  } catch (e) {
    toast.error(e.response?.data?.error || e.message);
  }
  return false;
}

/** Run whichever action this order is eligible for. */
export async function runAction(merchantId, order, opts) {
  const a = actionFor(order);
  if (a === 'release') return releaseOrder(merchantId, order, opts);
  if (a === 'confirm') return confirmPaidOrder(merchantId, order, opts);
  return false;
}

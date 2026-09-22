// MEXC payment-method ids → bank names (mirror of frontend/src/components/helpers.jsx).
// BingX names its methods directly, so anything non-numeric passes through.
const BANK_MAP = {
  176: 'SeaBank', 456: 'BCA', 459: 'OVO', 460: 'GoPay',
  463: 'ShopeePay', 469: 'DANA', 455: 'Blu BCA', 462: 'Allo Bank',
  465: 'CIMB Niaga', 461: 'Bank Jago', 452: 'BRI', 454: 'Permata',
  457: 'Mandiri', 569: 'Bank Transfer', 458: 'BNI', 738: 'Superbank',
  740: 'Bank Mandiri',
};
function bankName(payMethod, fallback) {
  const id = parseInt(payMethod);
  if (isNaN(id) && payMethod) return String(payMethod);
  return BANK_MAP[id] || fallback || (payMethod ? `Method ${payMethod}` : '');
}
module.exports = { BANK_MAP, bankName };

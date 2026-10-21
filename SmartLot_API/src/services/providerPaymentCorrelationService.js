import { getMerchantOrder } from './mpService.js';

function sameIdentifier(left, right) {
  return String(left) === String(right);
}

export async function providerPaymentMatchesLocal(payment, local, expectedPaymentId = null) {
  if (!payment || !local) return false;
  if (expectedPaymentId && !sameIdentifier(payment.id, expectedPaymentId)) return false;
  if (local.mp_payment_id && !sameIdentifier(payment.id, local.mp_payment_id)) return false;
  if (local.id_orden_externa && !sameIdentifier(payment.external_reference || '', local.id_orden_externa)) {
    return false;
  }
  if (!local.mp_preference_id) return true;

  // PaymentResponse no garantiza preference_id. Cuando esta presente es la
  // correlacion mas directa; cuando falta, la merchant order debe confirmar
  // simultaneamente preferencia, referencia externa y pertenencia del pago.
  if (payment.preference_id !== undefined && payment.preference_id !== null) {
    return sameIdentifier(payment.preference_id, local.mp_preference_id);
  }

  const merchantOrderId = payment.order?.id;
  if (!merchantOrderId || !local.id_orden_externa) return false;

  const merchantOrder = await getMerchantOrder(merchantOrderId);
  const orderPaymentIds = Array.isArray(merchantOrder?.payments)
    ? merchantOrder.payments.map((item) => String(item?.id))
    : [];

  return sameIdentifier(merchantOrder?.preference_id || '', local.mp_preference_id)
    && sameIdentifier(merchantOrder?.external_reference || '', local.id_orden_externa)
    && orderPaymentIds.includes(String(payment.id));
}

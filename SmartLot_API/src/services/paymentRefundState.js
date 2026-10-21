const CONFIRMED_REFUND_STATUSES = new Set(['approved']);
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function parseUnsignedCents(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === null) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  const normalized = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const cents = (BigInt(match[1]) * 100n) + BigInt((match[2] || '').padEnd(2, '0') || '0');
  if (cents > MAX_SAFE_CENTS) return null;
  return Number(cents);
}

function confirmedRefundsCents(refunds) {
  const seen = new Map();
  let total = 0;

  for (const refund of refunds) {
    if (!CONFIRMED_REFUND_STATUSES.has(String(refund?.status || '').toLowerCase())) continue;

    const amountCents = parseUnsignedCents(refund?.amount);
    if (amountCents === null || amountCents <= 0) {
      return { valid: false, reason: 'invalid_confirmed_refund_amount' };
    }

    // El id del proveedor es la identidad de la devolucion. Entradas repetidas
    // con el mismo id se cuentan una sola vez; importes distintos son una
    // contradiccion y no permiten calcular saldo.
    if (refund?.id === undefined || refund?.id === null || String(refund.id).trim() === '') {
      return { valid: false, reason: 'missing_confirmed_refund_id' };
    }
    const key = `id:${String(refund.id)}`;
    if (seen.has(key)) {
      if (seen.get(key) !== amountCents) return { valid: false, reason: 'contradictory_refund_amount' };
      continue;
    }
    seen.set(key, amountCents);
    total += amountCents;
    if (!Number.isSafeInteger(total)) return { valid: false, reason: 'refund_amount_out_of_range' };
  }

  return { valid: true, cents: total };
}

export function readProviderRefundState(payment) {
  const totalCents = parseUnsignedCents(payment?.transaction_amount);
  if (totalCents === null || totalCents <= 0) {
    return { known: false, valid: false, reason: 'invalid_transaction_amount' };
  }

  let refundedCents;
  let source;
  const hasCumulative = Object.prototype.hasOwnProperty.call(payment || {}, 'transaction_amount_refunded');

  if (hasCumulative) {
    refundedCents = parseUnsignedCents(payment.transaction_amount_refunded);
    if (refundedCents === null) {
      return { known: false, valid: false, totalCents, reason: 'invalid_transaction_amount_refunded' };
    }
    source = 'transaction_amount_refunded';
  } else if (Array.isArray(payment?.refunds)) {
    const fallback = confirmedRefundsCents(payment.refunds);
    if (!fallback.valid) return { known: false, valid: false, totalCents, reason: fallback.reason };
    refundedCents = fallback.cents;
    source = 'confirmed_refunds';
  } else {
    return { known: false, valid: true, totalCents, reason: 'refund_amount_unavailable' };
  }

  if (refundedCents > totalCents) {
    return { known: false, valid: false, totalCents, refundedCents, reason: 'refund_exceeds_transaction' };
  }

  const remainingCents = totalCents - refundedCents;
  const classification = refundedCents === 0
    ? 'none'
    : remainingCents === 0
      ? 'total'
      : 'partial';

  return {
    known: true,
    valid: true,
    source,
    totalCents,
    refundedCents,
    remainingCents,
    classification
  };
}

export { CONFIRMED_REFUND_STATUSES };

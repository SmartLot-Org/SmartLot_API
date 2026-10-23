import { readProviderRefundState } from './paymentRefundState.js';

// Payments API: date_last_updated is the last payment event, not our fetch time.
// Require an explicit timezone and a real calendar date; Date.parse alone accepts
// normalized invalid dates and timezone-less strings. MP emits millisecond ISO dates.
function timestamp(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, , zone] = m;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number(year) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function version(payment) {
  const updated = timestamp(payment?.date_last_updated);
  if (updated === null) return null;
  // A last event cannot precede creation or approval of this same payment.
  for (const field of ['date_created', 'date_approved']) {
    if (payment[field] != null) {
      const event = timestamp(payment[field]);
      if (event === null || event > updated) return null;
    }
  }
  return updated;
}

function state(payment) {
  const refunds = readProviderRefundState(payment);
  const reversal = payment.status === 'charged_back' || (refunds.known && refunds.valid && refunds.refundedCents > 0);
  return {
    reversal,
    approved: payment.status === 'approved' && refunds.known && refunds.valid && refunds.classification === 'none',
    refunded: refunds.known && refunds.valid ? refunds.refundedCents : null,
    signature: JSON.stringify([payment.status, String(payment.transaction_amount), payment.currency_id,
      refunds.known, refunds.valid, String(refunds.refundedCents)])
  };
}

// No arrival-time fallback. Financial evidence is monotonic: approval may advance
// to a verified reversal, but neither pending/rejected nor approved can erase it.
// Without comparable versions, only that explicit financial progression is safe.
export function decideEnterpriseObservation(previous, incoming) {
  if (!previous) return { apply: true };
  const oldVersion = version(previous);
  const newVersion = version(incoming);
  const before = state(previous);
  const after = state(incoming);
  if (oldVersion !== null && newVersion !== null) {
    if (newVersion < oldVersion) return { apply: false };
    if (newVersion === oldVersion) return { apply: false,
      issue: before.signature === after.signature ? null : 'conflicting_provider_observation' };
  }
  if (before.reversal && (!after.reversal ||
      (previous.status === 'charged_back' && incoming.status !== 'charged_back') ||
      (before.refunded !== null && (after.refunded === null || after.refunded < before.refunded)))) {
    return { apply: false, issue: 'conflicting_provider_observation' };
  }
  if (before.approved && !after.approved && !after.reversal) {
    return { apply: false, issue: 'conflicting_provider_observation' };
  }
  if (oldVersion === null || newVersion === null) {
    const progression = (!before.approved && !before.reversal && after.approved) ||
      (!before.reversal && after.reversal) ||
      (before.reversal && after.reversal && (incoming.status === 'charged_back' ||
        (after.refunded !== null && before.refunded !== null && after.refunded > before.refunded)));
    if (!progression) return { apply: false,
      issue: before.signature === after.signature ? null : 'unversioned_provider_observation' };
  }
  return { apply: true };
}

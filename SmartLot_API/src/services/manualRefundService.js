import crypto from 'crypto';
import pool from '../database/db.js';
import { getPayment, refundPayment } from './mpService.js';
import { providerPaymentMatchesLocal } from './providerPaymentCorrelationService.js';
import { CONFIRMED_REFUND_STATUSES, readProviderRefundState } from './paymentRefundState.js';
import { throwError } from '../helpers/httpError.js';

function moneyToCents(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throwError(`${fieldName} no es un importe valido.`, 409, 'inconsistent_payment');
  }
  const cents = Math.round(number * 100);
  if (Math.abs(number * 100 - cents) > 1e-7) {
    throwError(`${fieldName} tiene mas de dos decimales.`, 409, 'inconsistent_payment');
  }
  return cents;
}

function parseRequestedAmount(value, wasProvided) {
  if (!wasProvided) return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throwError('amount debe ser un importe numerico positivo.', 400, 'invalid_refund_amount');
  }

  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '' || (typeof normalized === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(normalized))) {
    throwError('amount debe ser un importe numerico positivo con hasta dos decimales.', 400, 'invalid_refund_amount');
  }

  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0) {
    throwError('amount debe ser un importe numerico positivo.', 400, 'invalid_refund_amount');
  }
  const cents = Math.round(number * 100);
  if (Math.abs(number * 100 - cents) > 1e-7) {
    throwError('amount debe tener como maximo dos decimales.', 400, 'invalid_refund_amount');
  }
  return cents;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throwError('El pago local tiene metadata invalida.', 409, 'inconsistent_payment');
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid metadata');
    return parsed;
  } catch {
    throwError('El pago local tiene metadata invalida.', 409, 'inconsistent_payment');
  }
}

function normalizeIdList(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) {
    throwError('Las referencias de consumos del pago son insuficientes.', 409, 'inconsistent_payment');
  }
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throwError('Las referencias de consumos del pago son invalidas.', 409, 'inconsistent_payment');
  }
  return ids;
}

async function resolveLocalPayment(paymentId) {
  const result = await pool.query(
    `SELECT p.*,
            r.id AS linked_reservation_id,
            ru.id_empresa AS reservation_company_id,
            e.id AS linked_company_id
       FROM pagos p
       LEFT JOIN reservas r ON r.id = p.id_reserva
       LEFT JOIN usuarios ru ON ru.id = r.id_usuario
       LEFT JOIN empresas e ON e.id = p.id_empresa
      WHERE p.mp_payment_id = $1
      LIMIT 1`,
    [paymentId]
  );

  const payment = result.rows[0];
  if (!payment) throwError('El pago no esta registrado en SmartLot.', 404, 'payment_not_found_local');

  const metadata = parseMetadata(payment.metadata);
  const metadataReservationId = metadata.id_reserva === undefined ? null : Number(metadata.id_reserva);

  if (payment.id_reserva !== null && payment.id_reserva !== undefined) {
    if (!payment.linked_reservation_id) {
      throwError('La reserva vinculada al pago no existe.', 409, 'inconsistent_payment');
    }
    if (metadataReservationId !== null && metadataReservationId !== Number(payment.id_reserva)) {
      throwError('Las referencias de reserva del pago se contradicen.', 409, 'inconsistent_payment');
    }
    if (payment.id_empresa !== null && payment.id_empresa !== undefined &&
        payment.reservation_company_id !== null && payment.reservation_company_id !== undefined &&
        Number(payment.id_empresa) !== Number(payment.reservation_company_id)) {
      throwError('La empresa del pago no coincide con la reserva vinculada.', 409, 'inconsistent_payment');
    }
  } else if (metadataReservationId !== null) {
    throwError('El pago declara una reserva sin una relacion local persistida.', 409, 'inconsistent_payment');
  }

  if (payment.id_empresa !== null && payment.id_empresa !== undefined && !payment.linked_company_id) {
    throwError('La empresa vinculada al pago no existe.', 409, 'inconsistent_payment');
  }

  const consumoIds = normalizeIdList(metadata.consumos_ids);
  if (consumoIds) {
    const consumosResult = await pool.query(
      `SELECT id, id_reserva, id_empresa
         FROM consumos_reserva
        WHERE id = ANY($1::int[])
        ORDER BY id`,
      [consumoIds]
    );
    if (consumosResult.rows.length !== consumoIds.length) {
      throwError('Uno o mas consumos vinculados al pago no existen.', 409, 'inconsistent_payment');
    }
    if (payment.id_empresa === null || payment.id_empresa === undefined ||
        consumosResult.rows.some((row) => Number(row.id_empresa) !== Number(payment.id_empresa))) {
      throwError('Los consumos vinculados no pertenecen a la empresa registrada en el pago.', 409, 'inconsistent_payment');
    }
    if (payment.id_reserva !== null && payment.id_reserva !== undefined &&
        !consumosResult.rows.some((row) => Number(row.id_reserva) === Number(payment.id_reserva))) {
      throwError('La reserva del pago no coincide con sus consumos vinculados.', 409, 'inconsistent_payment');
    }
  }

  const hasReservationLink = Boolean(payment.linked_reservation_id);
  const hasConsumptionLinks = Boolean(consumoIds);
  const hasProviderCorrelation = Boolean(payment.mp_preference_id && payment.id_orden_externa);
  if (!hasReservationLink && !hasConsumptionLinks && !hasProviderCorrelation) {
    throwError('El pago local no tiene referencias suficientes para autorizar un reembolso.', 409, 'inconsistent_payment');
  }

  return { ...payment, metadata, consumoIds };
}

async function getConfirmedRefunds(localPaymentId) {
  const result = await pool.query(
    `SELECT id, mp_refund_id, monto, moneda, estado, metadata, fecha_creacion
       FROM reembolsos
      WHERE id_pago = $1
        AND lower(COALESCE(estado, '')) = ANY($2::text[])
      ORDER BY fecha_creacion DESC, id DESC`,
    [localPaymentId, [...CONFIRMED_REFUND_STATUSES]]
  );
  return result.rows;
}

function refundFingerprint(localPaymentId, requestedCents) {
  const request = requestedCents === null ? 'full' : `partial:${requestedCents}`;
  return crypto.createHash('sha256').update(`smartlot-refund:${localPaymentId}:${request}`).digest('hex');
}

function refundMetadata(row) {
  return parseMetadata(row.metadata);
}

function idempotentResponse(refund) {
  return {
    httpStatus: 200,
    body: {
      refundId: refund.mp_refund_id,
      status: refund.estado,
      amount: Number(refund.monto),
      idempotent: true
    }
  };
}

async function validateProviderPayment(localPayment, providerPayment, paymentId) {
  if (!await providerPaymentMatchesLocal(providerPayment, localPayment, paymentId)) {
    throwError('Mercado Pago devolvio un recurso distinto al pago local.', 409, 'inconsistent_payment');
  }

  const localAmount = moneyToCents(localPayment.monto, 'El monto local');
  const providerAmount = moneyToCents(providerPayment.transaction_amount, 'El monto de Mercado Pago');
  if (localAmount !== providerAmount) {
    throwError('El monto local no coincide con Mercado Pago.', 409, 'inconsistent_payment');
  }
  if (String(localPayment.moneda || '') !== String(providerPayment.currency_id || '')) {
    throwError('La moneda local no coincide con Mercado Pago.', 409, 'inconsistent_payment');
  }
  return localAmount;
}

function providerRefundState(providerPayment) {
  const state = readProviderRefundState(providerPayment);
  if (!state.known || !state.valid) {
    throwError(
      'Mercado Pago no informo un saldo reembolsable consistente.',
      409,
      'inconsistent_provider_refund_state'
    );
  }
  return state;
}

async function persistConfirmedRefund({ localPayment, refund, actualCents, motivo, fingerprint, actorUserId, paymentStatus }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO reembolsos (id_pago, mp_refund_id, monto, moneda, estado, motivo, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (mp_refund_id) DO NOTHING`,
      [
        localPayment.id,
        String(refund.id),
        actualCents / 100,
        localPayment.moneda,
        String(refund.status).toLowerCase(),
        motivo,
        JSON.stringify({
          ...refund,
          smartlot: { requestFingerprint: fingerprint, requestedBy: actorUserId }
        })
      ]
    );
    const update = await client.query(
      `UPDATE pagos
          SET mp_payment_status = $1,
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              fecha_actualizacion = NOW()
        WHERE id = $3
        RETURNING id`,
      [
        paymentStatus,
        JSON.stringify({ lastRefundId: String(refund.id), lastRefundAt: new Date().toISOString() }),
        localPayment.id
      ]
    );
    if (!update.rows[0]) throwError('El pago local dejo de estar disponible.', 409, 'payment_changed');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function executeManualRefund({ paymentId, amount, amountProvided, motivo, actorUserId }) {
  const normalizedPaymentId = String(paymentId || '').trim();
  if (!/^\d+$/.test(normalizedPaymentId)) {
    throwError('paymentId debe ser el identificador numerico de Mercado Pago.', 400, 'invalid_payment_id');
  }

  const requestedCents = parseRequestedAmount(amount, amountProvided);
  if (motivo !== undefined && (typeof motivo !== 'string' || motivo.trim().length > 255)) {
    throwError('motivo debe ser texto de hasta 255 caracteres.', 400, 'invalid_refund_reason');
  }

  const localPayment = await resolveLocalPayment(normalizedPaymentId);
  const confirmedRefunds = await getConfirmedRefunds(localPayment.id);
  const fingerprint = refundFingerprint(localPayment.id, requestedCents);
  const repeated = confirmedRefunds.find((row) => refundMetadata(row)?.smartlot?.requestFingerprint === fingerprint);
  if (repeated) return idempotentResponse(repeated);

  const locallyRefundedCents = confirmedRefunds.reduce(
    (sum, row) => sum + moneyToCents(row.monto, 'Un reembolso local'),
    0
  );
  const localTotalCents = moneyToCents(localPayment.monto, 'El monto local');
  if (locallyRefundedCents >= localTotalCents) {
    if (confirmedRefunds[0]) return idempotentResponse(confirmedRefunds[0]);
    throwError('El pago ya fue reembolsado totalmente.', 409, 'payment_already_refunded');
  }

  const providerPayment = await getPayment(normalizedPaymentId);
  const totalCents = await validateProviderPayment(localPayment, providerPayment, normalizedPaymentId);
  const providerStatus = String(providerPayment.status || '').toLowerCase();
  if (!['approved', 'partially_refunded'].includes(providerStatus) && providerStatus !== 'refunded') {
    throwError('El pago no esta en un estado reembolsable confirmado por Mercado Pago.', 409, 'payment_not_refundable');
  }
  const refundState = providerRefundState(providerPayment);
  if (providerStatus === 'refunded' && refundState.classification === 'none') {
    throwError(
      'El estado y el acumulado de reembolsos de Mercado Pago se contradicen.',
      409,
      'inconsistent_provider_refund_state'
    );
  }
  const refundedBeforeCents = Math.max(locallyRefundedCents, refundState.refundedCents);
  const availableCents = totalCents - refundedBeforeCents;
  if (availableCents <= 0) {
    if (confirmedRefunds[0]) return idempotentResponse(confirmedRefunds[0]);
    throwError('Mercado Pago informa que el pago ya fue reembolsado totalmente.', 409, 'payment_already_refunded');
  }

  if (requestedCents !== null && requestedCents > availableCents) {
    throwError('amount supera el saldo reembolsable del pago.', 400, 'refund_amount_exceeds_balance');
  }

  const amountForProvider = requestedCents === null ? undefined : requestedCents / 100;
  const refund = await refundPayment(normalizedPaymentId, amountForProvider, fingerprint);
  const refundStatus = String(refund?.status || '').toLowerCase();
  if (!refund?.id || !CONFIRMED_REFUND_STATUSES.has(refundStatus)) {
    throwError('Mercado Pago no confirmo el reembolso.', 502, 'refund_not_confirmed');
  }

  const actualCents = moneyToCents(refund.amount, 'El importe confirmado por Mercado Pago');
  if (actualCents <= 0 || actualCents > availableCents) {
    throwError('Mercado Pago devolvio un importe de reembolso inconsistente.', 502, 'invalid_provider_refund');
  }

  const paymentStatus = refundedBeforeCents + actualCents >= totalCents ? 'refunded' : 'partially_refunded';
  await persistConfirmedRefund({
    localPayment,
    refund,
    actualCents,
    motivo: motivo?.trim() || 'Solicitado por superadmin',
    fingerprint,
    actorUserId,
    paymentStatus
  });

  return {
    httpStatus: 201,
    body: { refundId: String(refund.id), status: refundStatus, amount: actualCents / 100 }
  };
}

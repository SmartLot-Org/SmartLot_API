import { createEnterprisePreference, syncEnterprisePayment } from '../services/enterprisePaymentService.js';
import { Router } from 'express';
import {
  createPreference,
  getPayment,
  verifySignature,
  isSandbox
} from '../services/mpService.js';
import pool from '../database/db.js';
import { isValidId } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { executeManualRefund } from '../services/manualRefundService.js';
import {
  getAuthorizedPayment,
  listAuthorizedPayments,
  listWebhookEvents,
  verifyAuthorizedPayment,
  verifyAuthorizedPaymentsByReference
} from '../services/paymentReadService.js';
import { readProviderRefundState } from '../services/paymentRefundState.js';
import { throwError } from '../helpers/httpError.js';
import { BAD_REQUEST, CONFLICT, FORBIDDEN, SERVICE_UNAVAILABLE, UNAUTHORIZED } from '../helpers/httpStatus.js';

const router = Router();

async function savePaymentRecord(paymentData, idEmpresa = null, db = pool) {
  if (await syncEnterprisePayment(paymentData, db)) return null;
  const {
    id: mpPaymentId,
    preference_id: mpPreferenceId,
    external_reference: orderId,
    status: mpPaymentStatus,
    payment_type_id: mpPaymentType,
    transaction_amount: monto,
    currency_id: moneda,
    description: descripcion,
    date_approved: fechaAprobacion,
    metadata
  } = paymentData;

  // Intentar actualizar la fila de preferencia existente (mp_payment_id IS NULL) para preservar metadata.consumos_ids
  // Esto evita duplicar filas: preferencia (sin payment_id) -> pago (con payment_id) y mantiene vinculación con consumos
  if (mpPreferenceId || orderId) {
    try {
      const prefRes = await db.query(
        `SELECT id, metadata, mp_payment_id, mp_preference_id, id_orden_externa FROM pagos WHERE (mp_preference_id = $1 OR id_orden_externa = $2) AND mp_payment_id IS NULL LIMIT 1`,
        [mpPreferenceId || null, orderId || null]
      );
      // Solo actualizar una preferencia que realmente tenga preference_id.
      // Además de ser más seguro, conserva el fallback por payment_id para
      // registros legacy que no fueron creados desde /preference.
      if (prefRes.rows.length > 0 && prefRes.rows[0].mp_preference_id) {
        const existing = prefRes.rows[0];
        let existingMeta = existing.metadata;
        if (typeof existingMeta === 'string') {
          try { existingMeta = JSON.parse(existingMeta); } catch { existingMeta = {}; }
        }
        if (!existingMeta || typeof existingMeta !== 'object') existingMeta = {};
        // Merge: conservar consumos_ids y datos de la preferencia, añadir datos del pago de MP
        const mergedMeta = { ...existingMeta, ...paymentData, _mp_payment: paymentData };
        // Si la preferencia ya tenía consumos_ids, asegurar que se preserva
        if (existingMeta.consumos_ids && !mergedMeta.consumos_ids) mergedMeta.consumos_ids = existingMeta.consumos_ids;
        if (existingMeta.items && !mergedMeta.items) mergedMeta.items = existingMeta.items;

        const upd = await db.query(
          `UPDATE pagos SET
             mp_payment_id = $1,
             mp_payment_status = $2,
             mp_payment_type = $3,
             monto = COALESCE($4, monto),
             moneda = COALESCE($5, moneda),
             descripcion = COALESCE($6, descripcion),
             fecha_aprobacion = COALESCE($7, fecha_aprobacion),
             metadata = $8,
             fecha_actualizacion = NOW()
           WHERE id = $9
           RETURNING *`,
          [
            mpPaymentId,
            mpPaymentStatus,
            mpPaymentType,
            monto ?? null,
            moneda ?? null,
            descripcion ?? null,
            fechaAprobacion ? new Date(fechaAprobacion) : null,
            JSON.stringify(mergedMeta),
            existing.id
          ]
        );
        if (upd.rows[0]) return upd.rows[0];
      }
    } catch (e) {
      console.warn('[MP] savePaymentRecord pref update failed:', e.message);
    }
  }

  // Fallback: upsert por mp_payment_id (preservando metadata existente si ya había un pago)
  const query = `
    INSERT INTO pagos (
      id_reserva,
      id_orden_externa,
      mp_preference_id,
      mp_payment_id,
      mp_payment_status,
      mp_payment_type,
      monto,
      moneda,
      descripcion,
      fecha_aprobacion,
      metadata,
      id_empresa
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (mp_payment_id) DO UPDATE SET
      mp_payment_status = EXCLUDED.mp_payment_status,
      mp_payment_type = EXCLUDED.mp_payment_type,
      fecha_aprobacion = EXCLUDED.fecha_aprobacion,
      metadata = COALESCE(pagos.metadata, '{}'::jsonb) || EXCLUDED.metadata::jsonb,
      fecha_actualizacion = NOW()
    RETURNING *
  `;

  const values = [
    metadata?.id_reserva || null,
    orderId,
    mpPreferenceId,
    mpPaymentId,
    mpPaymentStatus,
    mpPaymentType,
    monto,
    moneda,
    descripcion,
    fechaAprobacion ? new Date(fechaAprobacion) : null,
    JSON.stringify(paymentData),
    idEmpresa
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

async function persistPaymentAndConfirmReservation(paymentData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const idReserva = Number(paymentData?.metadata?.id_reserva);
    const reserva = Number.isInteger(idReserva) ? (await client.query(
      `SELECT r.*,u.id_empresa FROM reservas r JOIN usuarios u ON u.id=r.id_usuario
        WHERE r.id=$1 FOR UPDATE OF r`, [idReserva]
    )).rows[0] : null;
    await savePaymentRecord(paymentData, reserva?.id_empresa ?? null, client);
    if (reserva && reserva.estado_reserva === 'pendiente_pago') {
      const amountMatches = Number(paymentData.transaction_amount) === Number(reserva.importe_estimado);
      const retencionVigente = new Date(reserva.retencion_pago_hasta) > new Date();
      if (paymentData.status === 'approved' && retencionVigente &&
          reserva.responsable_pago === 'empleado' && amountMatches) {
        await client.query(`UPDATE reservas SET estado_reserva='confirmada',retencion_pago_hasta=NULL WHERE id=$1`, [idReserva]);
      } else if (!retencionVigente && (paymentData.status === 'approved' ||
                 ['rejected', 'cancelled', 'charged_back'].includes(paymentData.status))) {
        // La retencion ya vencio: un pago aprobado fuera de tiempo o un pago
        // final negativo no deben seguir ocupando el lugar.
        await client.query(`UPDATE reservas SET estado_reserva='expirada' WHERE id=$1`, [idReserva]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function updatePaymentStatus(mpPaymentId, status, metadata = {}) {
  const query = `
    UPDATE pagos
    SET mp_payment_status = $1,
        metadata = metadata || $2,
        fecha_actualizacion = NOW()
    WHERE mp_payment_id = $3
    RETURNING *
  `;
  const result = await pool.query(query, [status, JSON.stringify(metadata), mpPaymentId]);
  return result.rows[0];
}

function paymentStatusAfterRefund(payment) {
  const state = readProviderRefundState(payment);
  if (!state.known || !state.valid || state.classification === 'none') {
    const error = new Error('Mercado Pago no informo un acumulado de reembolsos consistente.');
    error.statusCode = 409;
    error.code = 'inconsistent_provider_refund_state';
    throw error;
  }
  return state.classification === 'partial' ? 'partially_refunded' : 'refunded';
}

async function logWebhookEvent(eventData) {
  const { id: mpEventId, type: tipoEvento, data } = eventData;
  const mpPaymentId = data?.id ?? null;

  const query = `
    INSERT INTO webhook_eventos (mp_event_id, tipo_evento, mp_payment_id, payload, firma_valida)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (mp_event_id) DO NOTHING
    RETURNING *
  `;

  const values = [mpEventId, tipoEvento, mpPaymentId, JSON.stringify(eventData), true];
  await pool.query(query, values);
}

async function markWebhookProcessed(mpEventId, error = null) {
  const query = `
    UPDATE webhook_eventos
    SET procesado = TRUE,
        fecha_procesamiento = NOW(),
        error_procesamiento = $1
    WHERE mp_event_id = $2
  `;
  await pool.query(query, [error, mpEventId]);
}

router.post('/preference', requireRole(1, 2, 4), async (req, res) => {
  const { backUrls, idReserva } = req.body;

  // Sin idReserva es un pago empresarial de consumos.
  if (idReserva == null) {
    return res.status(201).json(await createEnterprisePreference(req.usuario, req.body));
  }
  if (Number(req.usuario?.id_rol) !== 2) throwError('Solo empleados pueden pagar reservas propias.', FORBIDDEN);
  if (!isValidId(String(idReserva))) throwError('idReserva inválido.', BAD_REQUEST);

  // La reserva del empleado usa su importe persistido, nunca uno enviado por el cliente.
  const expired = await pool.query(
    `UPDATE reservas SET estado_reserva='expirada'
      WHERE id=$1 AND estado_reserva='pendiente_pago' AND retencion_pago_hasta<=NOW()
      RETURNING id`, [idReserva]
  );

  let reserva = null;
  if (!expired.rowCount) {
    reserva = (await pool.query(
      `SELECT r.* FROM reservas r
        WHERE r.id=$1 AND r.id_usuario=$2 AND r.responsable_pago='empleado'`,
        [idReserva, req.usuario?.id]
    )).rows[0];
  }

  if (!reserva) throwError('La reserva no existe, expiro o no pertenece al empleado.', FORBIDDEN);
  if (reserva.estado_reserva !== 'pendiente_pago') throwError('La reserva no esta pendiente de pago.', CONFLICT);

  const existing = (await pool.query(
    `SELECT mp_preference_id FROM pagos
      WHERE id_reserva=$1 AND mp_preference_id IS NOT NULL
      ORDER BY id DESC LIMIT 1`, [idReserva]
  )).rows[0];
  if (existing) return res.status(200).json({ preferenceId: existing.mp_preference_id, reused: true, sandbox: isSandbox() });

  const orderId = `reserva-${reserva.id}`;
  const items = [{
    title: `Reserva SmartLot #${reserva.id}`,
    quantity: 1,
    unit_price: Number(reserva.importe_estimado),
    currency_id: 'ARS'
  }];

  const preference = await createPreference(items, orderId, backUrls, { id_reserva: reserva.id });

  await pool.query(
    `INSERT INTO pagos (id_orden_externa, mp_preference_id, monto, moneda, descripcion, id_empresa, metadata, id_reserva)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (mp_preference_id) DO NOTHING`,
    [
      orderId,
      preference.id,
      reserva.importe_estimado,
      'ARS',
      `Reserva ${orderId}`,
      req.usuario?.id_empresa || null,
      JSON.stringify({ id_reserva: reserva.id }),
      reserva.id
    ]
  );

  const sandbox = isSandbox();
  res.status(201).json({
    preferenceId: preference.id,
    initPoint: sandbox ? preference.sandbox_init_point : preference.init_point,
    sandboxInitPoint: preference.sandbox_init_point,
    sandbox
  });
});

router.get('/webhook-events', requireRole(4), async (req, res) => {
  res.json(await listWebhookEvents(req.query));
});

// Acción: sincroniza con Mercado Pago los pagos de una referencia (escribe en `pagos`).
router.post('/verificar', requireRole(1, 2, 4), async (req, res) => {
  res.json(await verifyAuthorizedPaymentsByReference(req.usuario, req.body));
});

// Lectura pura del estado local; la verificación contra Mercado Pago es POST /:paymentId/verificar.
router.get('/:paymentId', requireRole(1, 2, 4), async (req, res) => {
  res.json(await getAuthorizedPayment(req.usuario, req.params.paymentId));
});

// Acción: consulta el pago en Mercado Pago y sincroniza el registro local (escribe en `pagos`).
router.post('/:paymentId/verificar', requireRole(1, 2, 4), async (req, res) => {
  res.json(await verifyAuthorizedPayment(req.usuario, req.params.paymentId, req.body));
});

router.post('/webhook', async (req, res) => {
  // Fallar solo este endpoint; ninguna excepción de configuración habilita efectos.
  if (!process.env.MP_WEBHOOK_SECRET?.trim()) {
    throwError('Webhook no disponible temporalmente.', SERVICE_UNAVAILABLE);
  }
  let loggedEventId;
  try {
    if (!verifySignature(req)) {
      console.error('Invalid webhook signature');
      throwError('Firma de webhook inválida.', UNAUTHORIZED);
    }

    const { id: mpEventId, type: tipoEvento, action, data } = req.body || {};
    const validEventId = typeof mpEventId === 'string'
      ? mpEventId.trim().length > 0
      : Number.isSafeInteger(mpEventId) && mpEventId > 0;
    if (!validEventId || typeof tipoEvento !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(tipoEvento)) {
      throwError('Payload de webhook inválido.', BAD_REQUEST);
    }
    // Contrato oficial: type es el tópico; action distingue la operación.
    // Compatibilidad explícita con los antiguos type=payment.created/updated/refunded.
    const paymentActions = ['payment.created', 'payment.updated', 'payment.refunded'];
    const accionEvento = tipoEvento === 'payment' ? action
      : paymentActions.includes(tipoEvento) ? tipoEvento : null;
    if ((action !== undefined && (typeof action !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(action))) ||
        (tipoEvento === 'payment' && !paymentActions.includes(action)) ||
        (paymentActions.includes(tipoEvento) && action !== undefined && action !== tipoEvento)) {
      throwError('Payload de webhook inválido.', BAD_REQUEST);
    }
    // verifySignature exige que data.id del body coincida con el ID firmado de query.
    const paymentId = String(data.id);

    await logWebhookEvent(req.body);
    loggedEventId = mpEventId;

    if (accionEvento === 'payment.created' || accionEvento === 'payment.updated') {
      const payment = await getPayment(paymentId);
      if (!payment || String(payment.id) !== paymentId) throwError('Identidad de pago contradictoria en el proveedor.', CONFLICT);
      if (await syncEnterprisePayment(payment)) {
        // Orden empresarial verificada por asociaciones locales.
      } else if (payment?.metadata?.id_reserva) {
        await persistPaymentAndConfirmReservation(payment);
      } else {
        // Los pagos de Admin no están vinculados a una reserva pendiente.
        // Se sincronizan directamente para que PAGADA se refleje aunque no haya
        // webhook de reserva ni pool transaccional involucrado.
        await savePaymentRecord(payment);
      }
    } else if (accionEvento === 'payment.refunded') {
      const payment = await getPayment(paymentId);
      if (!payment || String(payment.id) !== paymentId) throwError('Identidad de pago contradictoria en el proveedor.', CONFLICT);
      if (!await syncEnterprisePayment(payment)) {
        await updatePaymentStatus(paymentId, paymentStatusAfterRefund(payment), { refundedAt: new Date().toISOString() });
      }
    }

    await markWebhookProcessed(mpEventId);

    res.status(200).json({ received: true });
  } catch (err) {
    // Se deja constancia del fallo en el evento ya registrado y se relanza el error original.
    if (loggedEventId !== undefined) {
      await markWebhookProcessed(loggedEventId, err.message).catch(() => {});
    }
    throw err;
  }
});

router.post('/:paymentId/refund', requireRole(4), async (req, res) => {
  const { paymentId } = req.params;
  const body = req.body || {};
  const { amount, motivo } = body;
  const result = await executeManualRefund({
    paymentId,
    amount,
    amountProvided: Object.prototype.hasOwnProperty.call(body, 'amount'),
    motivo,
    actorUserId: req.usuario.id
  });
  res.status(result.httpStatus).json(result.body);
});

router.get('/', requireRole(1, 2, 4), async (req, res) => {
  res.json(await listAuthorizedPayments(req.usuario, req.query));
});

export default router;

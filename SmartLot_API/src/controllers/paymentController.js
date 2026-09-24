import { Router } from 'express';
import {
  createPreference,
  getPayment,
  verifySignature,
  refundPayment,
  searchPayments,
  isSandbox
} from '../services/mpService.js';
import pool from '../database/db.js';
import { isValidId } from '../helpers/validatorHelper.js';

const router = Router();

function throwError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

async function savePaymentRecord(paymentData, idEmpresa = null, db = pool) {
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
      const prefRes = await pool.query(
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

        const upd = await pool.query(
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

router.post('/preference', async (req, res, next) => {
  try {
    let {
      items,
      orderId,
      backUrls,
      metadata,
      consumosIds,
      periodo,
      idGarage,
      idSede,
      idReserva
    } = req.body;

    let reserva = null;

    // Compatibilidad con el flujo de pago de reservas de empleados.
    // El flujo de Admin envía items/orderId y metadata de consumos.
    if (idReserva !== undefined && idReserva !== null) {
      if (!isValidId(String(idReserva))) throwError('idReserva is required', 400);

      const expired = await pool.query(
        `UPDATE reservas SET estado_reserva='expirada'
          WHERE id=$1 AND estado_reserva='pendiente_pago' AND retencion_pago_hasta<=NOW()
          RETURNING id`, [idReserva]
      );

      if (!expired.rowCount) {
        reserva = (await pool.query(
          `SELECT r.* FROM reservas r
            WHERE r.id=$1 AND r.id_usuario=$2 AND r.responsable_pago='empleado'`,
            [idReserva, req.usuario?.id]
        )).rows[0];
      }

      if (!reserva) throwError('La reserva no existe, expiro o no pertenece al empleado.', 403);
      if (reserva.estado_reserva !== 'pendiente_pago') throwError('La reserva no esta pendiente de pago.', 409);

      const existing = (await pool.query(
        `SELECT mp_preference_id FROM pagos
          WHERE id_reserva=$1 AND mp_preference_id IS NOT NULL
          ORDER BY id DESC LIMIT 1`, [idReserva]
      )).rows[0];
      if (existing) return res.status(200).json({ preferenceId: existing.mp_preference_id, reused: true, sandbox: isSandbox() });

      orderId = `reserva-${reserva.id}`;
      items = [{
        title: `Reserva SmartLot #${reserva.id}`,
        quantity: 1,
        unit_price: Number(reserva.importe_estimado),
        currency_id: 'ARS'
      }];
      metadata = { ...(metadata || {}), id_reserva: reserva.id };
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      throwError('Items array is required', 400);
    }

    if (!orderId) {
      throwError('orderId is required', 400);
    }

    // Cap sandbox a $0.10 máximo para permitir múltiples testeos con saldo chico
    // Aplica a pagos de admin (ADMIN-PAGO) o si MP_SANDBOX=true
    const esPagoAdmin = String(orderId).startsWith('ADMIN-PAGO-');
    const sandboxMode = !reserva && (isSandbox() || esPagoAdmin);
    if (sandboxMode) {
      const MAX_TEST = 0.10;
      items = items.map((it) => ({
        ...it,
        unit_price: Math.min(Number(it.unit_price ?? it.monto ?? 0), MAX_TEST),
      }));
      // Si tras cap el monto es 0, forzar 0.10 para que MP no rechace monto 0
      for (const it of items) {
        if (!(Number(it.unit_price) > 0)) it.unit_price = MAX_TEST;
      }
    }

    const preference = await createPreference(
      items,
      orderId,
      backUrls,
      reserva ? { id_reserva: reserva.id } : {}
    );

    // Metadata extendida para vincular con consumos_reserva (para marcar PAGADA)
    const extraMeta = {};
    if (metadata && typeof metadata === 'object') Object.assign(extraMeta, metadata);
    if (consumosIds) extraMeta.consumos_ids = consumosIds;
    else if (metadata?.consumos_ids) extraMeta.consumos_ids = metadata.consumos_ids;
    if (periodo) extraMeta.periodo = periodo;
    if (idGarage) extraMeta.id_garage = idGarage;
    if (idSede) extraMeta.id_sede = idSede;
    // Si items trae consumos_ids en descripción, propagar
    const metadataToStore = { items, orderId, ...extraMeta };

    await pool.query(
      `INSERT INTO pagos (id_orden_externa, mp_preference_id, monto, moneda, descripcion, id_empresa, metadata, id_reserva)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (mp_preference_id) DO NOTHING`,
      [
        orderId,
        preference.id,
        items.reduce((sum, item) => sum + (Number(item.unit_price || item.monto || 0) * Number(item.quantity || 1)), 0),
        'ARS',
        `Reserva ${orderId}`,
        req.usuario?.id_empresa || null,
        JSON.stringify({
          ...metadataToStore,
          ...(reserva ? { id_reserva: reserva.id } : {})
        }),
        reserva?.id || null
      ]
    );

    const sandbox = isSandbox();
    res.status(201).json({
      preferenceId: preference.id,
      initPoint: sandbox ? preference.sandbox_init_point : preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point,
      sandbox
    });
  } catch (err) {
    next(err);
  }
});

router.get('/webhook-events', async (req, res, next) => {
  try {
    const { procesado, limite = 100 } = req.query;

    const params = [];
    let where = '';
    if (procesado !== undefined) {
      params.push(procesado === 'true' || procesado === '1');
      where = ` WHERE procesado = $${params.length}`;
    }
    params.push(Math.min(Number(limite) || 100, 500));

    const query = `
      SELECT mp_event_id, tipo_evento, mp_payment_id, payload, firma_valida,
             procesado, error_procesamiento, fecha_recepcion, fecha_procesamiento
      FROM webhook_eventos
      ${where}
      ORDER BY fecha_recepcion DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);

    res.json({ eventos: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:paymentId', async (req, res, next) => {
  try {
    let { paymentId } = req.params;
    paymentId = String(paymentId || '').trim();

    if (!paymentId) {
      throwError('paymentId is required', 400);
    }

    // Permitir UUID (preference_id) y numérico (payment_id). Mensaje claro si parece merchant_order/otro.
    const isNumeric = /^\d+$/.test(paymentId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId);
    const isUuidWithPrefix = /^\d+-[0-9a-f-]{10,}$/i.test(paymentId);
    const looksComposite = paymentId.includes(';') || paymentId.includes('T') && paymentId.includes('UTC');
    if (looksComposite && !isNumeric && !isUuid) {
      return res.status(400).json({
        error: true,
        code: 'invalid_payment_id',
        message: `El valor "${paymentId}" no es un payment_id válido (numérico) ni preference_id (UUID). Parece un merchant_order_id. Usa GET /api/payments?external_reference=TU_ORDER_ID o verifica el payment_id numérico del comprobante de MP.`,
        statusCode: 400,
        paymentId
      });
    }
    // Si es UUID de preferencia, adelantar hint: el endpoint espera payment_id numérico
    if ((isUuid || isUuidWithPrefix) && !isNumeric) {
      // No bloqueamos (usuario pidió permitir UUID), pero avisamos en log
      console.warn(`[MP] GET /:paymentId recibido UUID (posible preference_id) ${paymentId} - se intenta como payment_id; si es preferencia usa external_reference`);
    }

    const payment = await getPayment(paymentId);

    const savedPayment = await savePaymentRecord(payment, req.usuario?.id_empresa);

    res.json({
      payment: {
        id: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail,
        paymentType: payment.payment_type_id,
        transactionAmount: payment.transaction_amount,
        currency: payment.currency_id,
        dateApproved: payment.date_approved,
        externalReference: payment.external_reference,
        preferenceId: payment.preference_id
      },
      saved: savedPayment
    });
  } catch (err) {
    // payment_not_found ya viene con statusCode 404 desde mpService
    if (err.statusCode === 404 || err.code === 'payment_not_found') {
      return res.status(404).json({
        error: true,
        code: err.code || 'payment_not_found',
        message: err.message || `Pago ${req.params.paymentId} no encontrado en Mercado Pago. Si acabas de pagar, espera 5-10s y reintenta o usa ?external_reference=`,
        statusCode: 404,
        paymentId: err.paymentId || req.params.paymentId
      });
    }
    next(err);
  }
});

router.post('/webhook', async (req, res, next) => {
  try {
    const isValid = verifySignature(req);

    if (!isValid) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { id: mpEventId, type: tipoEvento, data } = req.body;

    await logWebhookEvent(req.body);

    if (tipoEvento === 'payment.created' || tipoEvento === 'payment.updated') {
      const payment = await getPayment(data.id);
      if (payment?.metadata?.id_reserva) {
        await persistPaymentAndConfirmReservation(payment);
      } else {
        // Los pagos de Admin no están vinculados a una reserva pendiente.
        // Se sincronizan directamente para que PAGADA se refleje aunque no haya
        // webhook de reserva ni pool transaccional involucrado.
        await savePaymentRecord(payment);
      }
    } else if (tipoEvento === 'payment.refunded') {
      const payment = await getPayment(data.id);
      await updatePaymentStatus(data.id, 'refunded', { refundedAt: new Date().toISOString() });
    }

    await markWebhookProcessed(mpEventId);

    res.status(200).json({ received: true });
  } catch (err) {
    const mpEventId = req.body?.id;
    if (mpEventId) {
      await markWebhookProcessed(mpEventId, err.message).catch(() => {});
    }
    next(err);
  }
});

router.post('/:paymentId/refund', async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const { amount, motivo } = req.body;

    if (!paymentId) {
      throwError('paymentId is required', 400);
    }

    const refund = await refundPayment(paymentId, amount);

    const payment = await getPayment(paymentId);

    await pool.query(
      `INSERT INTO reembolsos (id_pago, mp_refund_id, monto, moneda, estado, motivo, metadata)
       SELECT id, $1, $2, $3, $4, $5, $6
       FROM pagos WHERE mp_payment_id = $7`,
      [
        refund.id,
        amount || payment.transaction_amount,
        payment.currency_id,
        refund.status,
        motivo || 'Solicitado por usuario',
        JSON.stringify(refund),
        paymentId
      ]
    );

    await updatePaymentStatus(paymentId, 'refunded', { refundId: refund.id, refundedAt: new Date().toISOString() });

    res.status(201).json({
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { external_reference, status, from, to } = req.query;

    const filters = {};
    if (external_reference) filters.external_reference = external_reference;
    if (status) filters.status = status;
    if (from || to) filters.range = { from, to };

    const result = await searchPayments(filters);

    // Sincronizar automáticamente pagos encontrados (sin webhook) → actualiza mp_payment_status en DB
    const items = result?.results || result?.data || [];
    if (external_reference && Array.isArray(items) && items.length > 0) {
      for (const p of items) {
        try {
          if (p?.id && p?.status) {
            await savePaymentRecord(p, req.usuario?.id_empresa);
          }
        } catch (syncErr) {
          console.warn(`[MP] sync pagos failed for ${p?.id}:`, syncErr.message);
        }
      }
    }

    res.json(result);
  } catch (err) {
    if (err.statusCode === 404 || err.code === 'payment_not_found') {
      return res.status(404).json({ error: true, code: err.code || 'payment_not_found', message: err.message, statusCode: 404 });
    }
    next(err);
  }
});

export default router;

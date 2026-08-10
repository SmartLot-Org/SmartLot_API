import { Router } from 'express';
import {
  createPreference,
  getPayment,
  verifySignature,
  refundPayment,
  searchPayments
} from '../services/mpService.js';
import pool from '../database/db.js';
import { isValidId } from '../helpers/validatorHelper.js';

const router = Router();

function throwError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

async function savePaymentRecord(paymentData, idEmpresa = null) {
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
      metadata = EXCLUDED.metadata,
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

  const result = await pool.query(query, values);
  return result.rows[0];
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
    const { items, orderId, backUrls } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throwError('Items array is required', 400);
    }

    if (!orderId) {
      throwError('orderId is required', 400);
    }

    const preference = await createPreference(items, orderId, backUrls);

    await pool.query(
      `INSERT INTO pagos (id_orden_externa, mp_preference_id, monto, moneda, descripcion, id_empresa, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (mp_preference_id) DO NOTHING`,
      [
        orderId,
        preference.id,
        items.reduce((sum, item) => sum + (Number(item.unit_price || item.monto || 0) * Number(item.quantity || 1)), 0),
        'ARS',
        `Reserva ${orderId}`,
        req.usuario?.id_empresa || null,
        JSON.stringify({ items, orderId })
      ]
    );

    res.status(201).json({
      preferenceId: preference.id,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point
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
    const { paymentId } = req.params;

    if (!paymentId) {
      throwError('paymentId is required', 400);
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
      await savePaymentRecord(payment);
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

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
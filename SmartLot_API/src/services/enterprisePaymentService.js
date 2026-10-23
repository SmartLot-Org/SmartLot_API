import { randomUUID } from 'node:crypto';
import pool from '../database/db.js';
import * as mp from './mpService.js';
import { providerPaymentMatchesLocal } from './providerPaymentCorrelationService.js';
import { readProviderRefundState } from './paymentRefundState.js';
import { decideEnterpriseObservation } from './enterprisePaymentObservation.js';

const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
export function cents(value) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!m) fail('Importe monetario invalido.');
  const result = BigInt(m[1]) * 100n + BigInt((m[2] || '').padEnd(2, '0') || '0');
  if (result > 99999999999n) fail('Importe fuera de rango.');
  return result;
}
const decimal = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
const validId = (value) => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));

export async function createEnterprisePreference(user, body = {}) {
  if (![1, 4].includes(Number(user?.id_rol))) fail('Rol no autorizado para pagos empresariales.', 403);
  const company = Number(Number(user.id_rol) === 4 ? body.idEmpresa : user.id_empresa);
  const site = user.id_sede ? Number(user.id_sede) : (body.idSede == null ? null : Number(body.idSede));
  if (!validId(company) || (site !== null && !validId(site))) fail('Contexto empresarial invalido.', 403);
  if (user.id_sede && body.idSede != null && Number(body.idSede) !== site) fail('Sede no autorizada.', 403);
  if (!Array.isArray(body.consumosIds) || !body.consumosIds.length || body.consumosIds.length > 1000 ||
      body.consumosIds.some(id => !validId(id))) fail('Seleccione consumos validos (maximo 1000).', 400);
  const ids = [...new Set(body.consumosIds.map(String))];
  const client = await pool.connect();
  let reference;
  let total;
  let selected;
  try {
    await client.query('BEGIN');
    const rows = (await client.query(
      `SELECT c.* FROM consumos_reserva c JOIN sedes s ON s.id=c.id_sede
       WHERE c.id=ANY($1::bigint[]) AND c.id_empresa=$2 AND s.id_empresa=$2
         AND ($3::integer IS NULL OR c.id_sede=$3) AND c.responsable_pago='empresa'
       ORDER BY c.id FOR UPDATE OF c`, [ids, company, site])).rows;
    if (rows.length !== ids.length) fail('La seleccion contiene consumos inexistentes o no autorizados.', 403);
    if (body.idGarage != null && rows.some(r => Number(r.id_garage) !== Number(body.idGarage))) fail('Garage incompatible.', 400);
    if (body.periodo != null && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.periodo) || rows.some(r => new Date(r.fecha_inicio).toISOString().slice(0, 7) !== body.periodo))) fail('Periodo incompatible.', 400);
    const claims = (await client.query(
      `SELECT ec.consumption_id, eo.settled, p.mp_payment_status
       FROM enterprise_payment_consumptions ec JOIN enterprise_payment_orders eo USING(reference)
       LEFT JOIN pagos p ON p.id_orden_externa=eo.reference AND p.mp_preference_id=eo.preference_id AND p.mp_payment_id=eo.accepted_payment_id
       WHERE ec.consumption_id=ANY($1::bigint[])`, [ids])).rows;
    const paid = new Set(claims.filter(c => c.settled && c.mp_payment_status === 'approved').map(c => String(c.consumption_id)));
    if (claims.some(c => !paid.has(String(c.consumption_id)))) fail('Hay consumos con una orden vigente o pendiente de regularizacion.');
    selected = rows.filter(r => !paid.has(String(r.id)) && cents(r.importe_generado) > 0n);
    total = selected.reduce((sum, r) => sum + cents(r.importe_generado), 0n);
    if (!total) fail('No hay saldo pendiente para cobrar.');
    cents(decimal(total));
    reference = `EMP-${randomUUID()}`;
    await client.query(`INSERT INTO enterprise_payment_orders(reference,id_empresa,id_sede,expected_amount,currency)
      VALUES($1,$2,$3,$4,'ARS')`, [reference, company, site, decimal(total)]);
    for (const row of selected) await client.query(`INSERT INTO enterprise_payment_consumptions(reference,consumption_id,expected_amount) VALUES($1,$2,$3)`, [reference, row.id, row.importe_generado]);
    await client.query(`INSERT INTO pagos(id_orden_externa,monto,moneda,id_empresa,metadata)
      VALUES($1,$2,'ARS',$3,$4::jsonb)`, [reference, decimal(total), company, JSON.stringify({ consumos_ids: selected.map(r => String(r.id)) })]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') fail('Los consumos ya tienen una orden de pago.');
    throw error;
  } finally { client.release(); }
  // La orden y sus claims ya existen: un timeout nunca habilita otro checkout.
  const preference = await mp.createPreference([{ title: 'Consumos SmartLot', quantity: 1, unit_price: Number(decimal(total)), currency_id: 'ARS' }], reference, body.backUrls);
  const update = await pool.connect();
  try {
    await update.query('BEGIN');
    await update.query('UPDATE enterprise_payment_orders SET preference_id=$1 WHERE reference=$2 AND preference_id IS NULL', [preference.id, reference]);
    await update.query('UPDATE pagos SET mp_preference_id=$1 WHERE id_orden_externa=$2', [preference.id, reference]);
    await update.query('COMMIT');
  } catch (e) { await update.query('ROLLBACK'); throw e; }
  finally { update.release(); }
  return { preferenceId: preference.id, orderId: reference, amount: Number(decimal(total)), currency: 'ARS', consumosIds: selected.map(r => String(r.id)),
    initPoint: mp.isSandbox() ? preference.sandbox_init_point : preference.init_point, sandboxInitPoint: preference.sandbox_init_point, sandbox: mp.isSandbox() };
}

// Solo despues de autorizar la fila local; no otorga permisos sobre una referencia.
export async function getEnterpriseOrderForLocal(local) {
  const result = await pool.query(`SELECT * FROM enterprise_payment_orders
    WHERE reference=$1 AND preference_id=$2`, [local.id_orden_externa, local.mp_preference_id]);
  return result.rows[0] ?? null;
}

// Cada candidato se correlaciona con el checkout; el pago aceptado tiene identidad
// propia e inmutable. Un intento diferente nunca modifica su evidencia financiera.
export async function syncEnterprisePayment(payment, db = pool) {
  const orders = (await db.query(`SELECT eo.* FROM enterprise_payment_orders eo
    WHERE reference=$1 OR payment_id=$2 OR preference_id=$3 ORDER BY reference FOR UPDATE OF eo`,
  [payment.external_reference || null, String(payment.id), payment.preference_id || null])).rows;
  if (!orders.length) return false;
  if (orders.length !== 1) fail('Correlacion empresarial ambigua.');
  if (db === pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const handled = await syncEnterprisePayment(payment, client);
      await client.query('COMMIT');
      return handled;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const order = orders[0];
  if (!order.preference_id || !validId(payment.id)) return true;
  const paymentId = String(payment.id);
  const correlated = await providerPaymentMatchesLocal(payment, {
    id_orden_externa: order.reference, mp_preference_id: order.preference_id
  }, paymentId);
  if (!correlated) return true;

  const priorAttempt = (await db.query('SELECT * FROM enterprise_payment_attempts WHERE payment_id=$1', [paymentId])).rows[0];
  if (priorAttempt && priorAttempt.reference !== order.reference) fail('El intento pertenece a otra orden.');
  const refunds = readProviderRefundState(payment);
  let amountMatches = false;
  try { amountMatches = cents(payment.transaction_amount) === cents(order.expected_amount); } catch { /* falla cerrado */ }
  const economicsMatch = amountMatches && payment.currency_id === order.currency;
  const reversed = economicsMatch && (payment.status === 'charged_back' ||
    (refunds.known && refunds.valid && refunds.refundedCents > 0));
  const eligible = economicsMatch && payment.status === 'approved' && refunds.known && refunds.valid &&
    refunds.classification === 'none' && !priorAttempt?.reversal_snapshot;
  const localPayment = (await db.query(`SELECT mp_payment_status,metadata FROM pagos
    WHERE id_orden_externa=$1 AND mp_preference_id=$2 AND mp_payment_id=$3 FOR UPDATE`,
  [order.reference, order.preference_id, order.accepted_payment_id])).rows[0];
  const locallyReversed = localPayment && (['refunded','partially_refunded','charged_back'].includes(localPayment.mp_payment_status) || localPayment.metadata?.lastRefundId);
  if (order.accepted_payment_id === paymentId && locallyReversed) await db.query(`UPDATE enterprise_payment_orders
    SET settled=false,review_reason='reversal_requires_regularization' WHERE reference=$1`, [order.reference]);
  let previousSnapshot = priorAttempt?.provider_snapshot ||
    (order.accepted_payment_id === paymentId ? order.provider_snapshot : null);
  // An economically invalid, unaccepted attempt is not valid financial evidence.
  // It must not prevent a subsequent fully verified approval of that same ID.
  if (!order.accepted_payment_id && previousSnapshot && economicsMatch) {
    try {
      if (cents(previousSnapshot.transaction_amount) !== cents(order.expected_amount) ||
          previousSnapshot.currency_id !== order.currency) previousSnapshot = null;
    } catch { previousSnapshot = null; }
  }
  const decision = decideEnterpriseObservation(previousSnapshot, payment);
  if (!decision.apply || (order.accepted_payment_id === paymentId && !eligible && !reversed)) {
    const issue = decision.issue || (decision.apply ? 'invalid_accepted_payment_observation' : null);
    if (issue) await db.query(`UPDATE enterprise_payment_orders
      SET reconciliation_issue=COALESCE(reconciliation_issue,$2) WHERE reference=$1`, [order.reference, issue]);
    return true;
  }
  const previouslyReversed = Boolean((order.accepted_payment_id === paymentId && (order.reversal_snapshot || locallyReversed)) || priorAttempt?.reversal_snapshot);
  if (previouslyReversed && !reversed) {
    if (order.accepted_payment_id === paymentId) await db.query(`UPDATE enterprise_payment_orders
      SET settled=false,review_reason='reversal_requires_regularization' WHERE reference=$1`, [order.reference]);
    return true;
  }
  const recorded = await db.query(`INSERT INTO enterprise_payment_attempts(payment_id,reference,provider_snapshot,eligible_snapshot,reversal_snapshot)
    VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)
    ON CONFLICT(payment_id) DO UPDATE SET provider_snapshot=EXCLUDED.provider_snapshot,
      eligible_snapshot=COALESCE(enterprise_payment_attempts.eligible_snapshot,EXCLUDED.eligible_snapshot),
      reversal_snapshot=COALESCE(enterprise_payment_attempts.reversal_snapshot,EXCLUDED.reversal_snapshot), verified_at=NOW()
    WHERE enterprise_payment_attempts.reference=EXCLUDED.reference RETURNING payment_id`,
  [paymentId, order.reference, JSON.stringify(payment), eligible ? JSON.stringify(payment) : null, reversed ? JSON.stringify(payment) : null]);
  if (recorded.rows.length !== 1) fail('El intento cambio de orden durante la verificacion.');

  if (order.accepted_payment_id && paymentId !== order.accepted_payment_id) {
    if (payment.status === 'approved' && refunds.known && refunds.valid && refunds.classification === 'none') await db.query(
      `UPDATE enterprise_payment_orders SET reconciliation_issue='multiple_approved_payments' WHERE reference=$1`, [order.reference]);
    return true;
  }
  if (!order.accepted_payment_id && !eligible) return true;

  const settled = eligible && !previouslyReversed;
  const reason = reversed || previouslyReversed ? 'reversal_requires_regularization' : settled ? null : 'pending_regularization_or_unconfirmed';
  await db.query(`UPDATE enterprise_payment_orders SET settled=$1,review_reason=$2,
    provider_snapshot=$3::jsonb,verified_at=NOW(),payment_id=$4,accepted_payment_id=$4,
    reversal_snapshot=COALESCE(reversal_snapshot,$6::jsonb) WHERE reference=$5`,
  [settled, reason, JSON.stringify(payment), paymentId, order.reference, reversed ? JSON.stringify(payment) : null]);
  const status = reversed ? payment.status === 'charged_back' ? 'charged_back' :
    refunds.classification === 'total' ? 'refunded' : 'partially_refunded' : payment.status;
  const updated = await db.query(`UPDATE pagos SET mp_payment_id=$1,mp_payment_status=$2,
    mp_payment_type=$3,fecha_actualizacion=NOW(),metadata=metadata || jsonb_build_object('_mp_payment_summary',$4::jsonb)
    WHERE id_orden_externa=$5 AND mp_preference_id=$6 RETURNING id`,
  [paymentId, status, payment.payment_type_id || null, JSON.stringify(payment), order.reference, order.preference_id]);
  if (updated.rows.length !== 1) fail('La fila local de la orden es inexistente o ambigua.');
  return true;
}

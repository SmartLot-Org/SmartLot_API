import 'dotenv/config';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';

process.env.MP_WEBHOOK_SECRET = 'mp-it-secret-de-prueba';

const { default: app } = await import('../src/app.js');
const { createPreference, getPayment, refundPayment, searchPayments } = await import('../src/services/mpService.js');
const { MercadoPagoConfig, Payment, CardToken } = await import('mercadopago');
const pool = (await import('../src/database/db.js')).default;

const cfg = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const RUN = 'mp-it-' + Date.now();
const BUYER_EMAIL = 'test_user_smartlot@testuser.com';
const canCreatePayments = process.env.MP_ACCESS_TOKEN?.startsWith('TEST-');

async function createApprovedPayment(amount, externalRef) {
  const cardToken = await new CardToken(cfg).create({
    body: {
      card_number: '4509 9535 6623 3704',
      expiration_month: '12',
      expiration_year: String(new Date().getFullYear() + 2),
      security_code: '123'
    }
  });

  return new Payment(cfg).create({
    body: {
      transaction_amount: amount,
      token: cardToken.id,
      description: `Pago integracion ${externalRef}`,
      installments: 1,
      payment_method_id: 'visa',
      payer: { email: BUYER_EMAIL }
    }
  });
}

test('crea preferencia de pago real y devuelve init_point', async () => {
  const orderId = `${RUN}-pref`;
  const preference = await createPreference(
    [{ id: 'res-1', title: 'Reserva garage test', unit_price: 1500, quantity: 1 }],
    orderId
  );

  assert.ok(preference.id, 'deberia tener id de preferencia');
  assert.ok(preference.init_point || preference.sandbox_init_point, 'deberia tener init_point');
  assert.equal(preference.external_reference, orderId);
  assert.equal(preference.items.length, 1);
  assert.equal(preference.items[0].title, 'Reserva garage test');
});

test('busca pagos reales por external_reference', async () => {
  const result = await searchPayments({ external_reference: `${RUN}-pref` });
  assert.ok(Array.isArray(result.results));
});

test('pago con tarjeta de prueba se aprueba y se reembolsa total', { skip: !canCreatePayments && 'Requiere credenciales TEST- para crear pagos' }, async () => {
  const payment = await createApprovedPayment(1200, `${RUN}-full`);
  assert.equal(payment.status, 'approved');

  const refund = await refundPayment(payment.id);
  assert.ok(refund.id);
  assert.equal(refund.amount, 1200);

  const after = await getPayment(payment.id);
  assert.ok(after.refunds?.length > 0 || after.status_detail === 'refunded', 'el pago deberia quedar reembolsado');
});

test('reembolso parcial conserva el pago aprobado', { skip: !canCreatePayments && 'Requiere credenciales TEST- para crear pagos' }, async () => {
  const payment = await createApprovedPayment(2000, `${RUN}-partial`);
  assert.equal(payment.status, 'approved');

  const refund = await refundPayment(payment.id, 800);
  assert.ok(refund.id);
  assert.equal(refund.amount, 800);
});

test('webhook HTTP valida firma, procesa evento y persiste en la BD', { skip: !canCreatePayments && 'Requiere credenciales TEST- para crear pagos' }, async () => {
  const payment = await createApprovedPayment(900, `${RUN}-webhook`);
  assert.equal(payment.status, 'approved');

  const eventId = `mpit-evt-${Date.now()}`;
  const dataId = payment.id;
  const requestId = `req-${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');

  const res = await request(app)
    .post('/api/payments/webhook')
    .set('x-signature', `ts=${ts},v1=${hash}`)
    .set('x-request-id', requestId)
    .send({ id: eventId, type: 'payment.updated', data: { id: dataId } });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const evento = await pool.query('SELECT procesado, error_procesamiento FROM webhook_eventos WHERE mp_event_id = $1', [eventId]);
  assert.equal(evento.rows.length, 1);
  assert.equal(evento.rows[0].procesado, true);
  assert.equal(evento.rows[0].error_procesamiento, null);

  const pago = await pool.query('SELECT mp_payment_status FROM pagos WHERE mp_payment_id = $1', [dataId]);
  assert.equal(pago.rows.length, 1);
});

test('webhook HTTP con firma invalida responde 400', async () => {
  const res = await request(app)
    .post('/api/payments/webhook')
    .set('x-signature', 'ts=1,v1=' + 'a'.repeat(64))
    .set('x-request-id', 'req-invalida')
    .send({ id: `mpit-evt-bad-${Date.now()}`, type: 'payment.updated', data: { id: '999999' } });

  assert.equal(res.status, 400);
});

test('webhook HTTP con firma valida pero pago inexistente marca el evento con error', async () => {
  const eventId = `mpit-evt-missing-${Date.now()}`;
  const requestId = `req-${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:999999;request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');

  const res = await request(app)
    .post('/api/payments/webhook')
    .set('x-signature', `ts=${ts},v1=${hash}`)
    .set('x-request-id', requestId)
    .send({ id: eventId, type: 'payment.updated', data: { id: '999999' } });

  assert.equal(res.status, 500);

  const evento = await pool.query('SELECT procesado, error_procesamiento FROM webhook_eventos WHERE mp_event_id = $1', [eventId]);
  assert.equal(evento.rows.length, 1);
  assert.equal(evento.rows[0].procesado, true);
  assert.ok(evento.rows[0].error_procesamiento, 'deberia guardar el error de procesamiento');
});

test('rutas protegidas exigen autenticacion', async () => {
  const res = await request(app)
    .post('/api/payments/preference')
    .send({ items: [{ title: 'x', unit_price: 1 }], orderId: 'x' });

  assert.equal(res.status, 401);
});

after(async () => {
  try {
    await pool.query(`DELETE FROM webhook_eventos WHERE mp_event_id LIKE 'mpit-evt-%'`);
    await pool.query(`DELETE FROM reembolsos WHERE id_pago IN (SELECT id FROM pagos WHERE id_orden_externa LIKE '${RUN}-%')`);
    await pool.query(`DELETE FROM pagos WHERE id_orden_externa LIKE '${RUN}-%'`);
    await pool.end();
  } catch (err) {
    console.error('Cleanup de integracion fallo:', err.message);
  }
});
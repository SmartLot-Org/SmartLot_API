import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const calls = { preference: [], payment: [], refund: [] };

mock.module('mercadopago', {
  namedExports: {
    MercadoPagoConfig: class {
      constructor(config) { this.config = config; }
    },
    Preference: class {
      constructor(client) { this.client = client; }
      async create({ body }) { calls.preference.push(body); return { id: 'pref-123', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref=123', sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref=123', external_reference: body.external_reference }; }
    },
    Payment: class {
      constructor(client) { this.client = client; }
      async get({ id }) { calls.payment.push({ kind: 'get', id }); return { id, status: 'approved', status_detail: 'accredited', payment_type_id: 'credit_card', transaction_amount: 100, currency_id: 'ARS', external_reference: 'ORD-1', preference_id: 'pref-123', date_approved: new Date().toISOString() }; }
      async search({ options }) { calls.payment.push({ kind: 'search', options }); return { results: [{ id: 'p-1' }] }; }
    },
    PaymentRefund: class {
      constructor(client) { this.client = client; }
      async create({ payment_id, body }) { calls.refund.push({ payment_id, body }); return { id: 'refund-1', status: 'approved', amount: body.amount ?? 100 }; }
    }
  }
});

const { createPreference, getPayment, verifySignature, refundPayment, searchPayments, isSandbox } = await import('../src/services/mpService.js');

test.beforeEach(() => {
  calls.preference.length = 0;
  calls.payment.length = 0;
  calls.refund.length = 0;
});

function computeSignature(dataId, requestId, ts, secret) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

test('createPreference normaliza items y arma el body completo', async () => {
  delete process.env.MP_AUTO_RETURN;
  delete process.env.MP_SANDBOX;
  const result = await createPreference(
    [{ id: 5, title: 'Reserva garage', unit_price: 1500, quantity: 2 }],
    'ORD-42'
  );

  const body = calls.preference[0];
  assert.equal(result.id, 'pref-123');
  assert.equal(body.external_reference, 'ORD-42');
  assert.deepEqual(body.items, [{ id: 5, title: 'Reserva garage', description: '', quantity: 2, unit_price: 1500, currency_id: 'ARS' }]);
  assert.equal(Object.hasOwn(body, 'auto_return'), false);
  assert.equal(body.back_urls.success, `${process.env.FRONTEND_URL}/payment/success`);
  assert.equal(Object.hasOwn(body, 'notification_url'), false, 'no debe mandar notification_url cuando BACKEND_URL es localhost');
});

test('createPreference incluye notification_url solo cuando BACKEND_URL es publica', async () => {
  const originalBackend = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://api.smartlot.ar';
  await createPreference([{ title: 'x', unit_price: 100 }], 'ORD-9');
  assert.equal(calls.preference[0].notification_url, 'https://api.smartlot.ar/api/payments/webhook');
  process.env.BACKEND_URL = originalBackend;
});

test('isSandbox lee MP_SANDBOX como flag', () => {
  assert.equal(isSandbox(), false);
  process.env.MP_SANDBOX = 'true';
  assert.equal(isSandbox(), true);
  process.env.MP_SANDBOX = '1';
  assert.equal(isSandbox(), true);
  process.env.MP_SANDBOX = 'false';
  assert.equal(isSandbox(), false);
  delete process.env.MP_SANDBOX;
});

test('createPreference incluye auto_return solo si MP_AUTO_RETURN esta configurado', async () => {
  process.env.MP_AUTO_RETURN = 'approved';
  await createPreference([{ title: 'x', unit_price: 100 }], 'ORD-1');
  assert.equal(calls.preference[0].auto_return, 'approved');
  delete process.env.MP_AUTO_RETURN;
});

test('createPreference admite campos alternativos (monto) y back_urls custom', async () => {
  await createPreference(
    [{ descripcion: 'Pase mensual', monto: '900.50', quantity: '1' }],
    'ORD-1',
    { success: 'https://front.example/ok' }
  );
  const body = calls.preference[0];
  assert.deepEqual(body.items, [{ id: 'item', title: 'Pase mensual', description: '', quantity: 1, unit_price: 900.5, currency_id: 'ARS' }]);
  assert.equal(body.back_urls.success, 'https://front.example/ok');
});

test('getPayment delega el id al cliente Payment', async () => {
  const payment = await getPayment('PAY-9');
  assert.equal(payment.id, 'PAY-9');
  assert.deepEqual(calls.payment, [{ kind: 'get', id: 'PAY-9' }]);
});

test('verifySignature en modo dev (sin MP_WEBHOOK_SECRET) acepta cualquier request', () => {
  delete process.env.MP_WEBHOOK_SECRET;
  const ok = verifySignature({ headers: {}, query: {}, body: {} });
  assert.equal(ok, true);
});

test('verifySignature con secret: firma valida pasa', () => {
  const secret = 'mi-secret-de-test';
  process.env.MP_WEBHOOK_SECRET = secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const dataId = 'PAY-123';
  const requestId = 'req-abc';
  const hash = computeSignature(dataId, requestId, ts, secret);

  const ok = verifySignature({
    headers: { 'x-signature': `ts=${ts}, v1=${hash}`, 'x-request-id': requestId },
    query: { 'data.id': dataId },
    body: {}
  });
  assert.equal(ok, true);
});

test('verifySignature con secret: firma alterada se rechaza', () => {
  const secret = 'mi-secret-de-test';
  process.env.MP_WEBHOOK_SECRET = secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const hash = computeSignature('PAY-123', 'req-abc', ts, secret);

  const ok = verifySignature({
    headers: { 'x-signature': `ts=${ts}, v1=${'0'.repeat(64)}`, 'x-request-id': 'req-abc' },
    query: { 'data.id': 'PAY-123' },
    body: {}
  });
  assert.equal(ok, false);
});

test('verifySignature con secret: falta de headers se rechaza', () => {
  process.env.MP_WEBHOOK_SECRET = 'x';
  assert.equal(verifySignature({ headers: {}, query: {}, body: {} }), false);
});

test('verifySignature con secret: falta data.id se rechaza', () => {
  const secret = 'mi-secret-de-test';
  process.env.MP_WEBHOOK_SECRET = secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const hash = computeSignature('PAY-123', 'req-abc', ts, secret);

  const ok = verifySignature({
    headers: { 'x-signature': `ts=${ts}, v1=${hash}`, 'x-request-id': 'req-abc' },
    query: {},
    body: {}
  });
  assert.equal(ok, false);
});

test('verifySignature usa data.id del body cuando no viene en query', () => {
  const secret = 'mi-secret-de-test';
  process.env.MP_WEBHOOK_SECRET = secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const hash = computeSignature('PAY-123', 'req-abc', ts, secret);

  const ok = verifySignature({
    headers: { 'x-signature': `ts=${ts}, v1=${hash}`, 'x-request-id': 'req-abc' },
    query: {},
    body: { data: { id: 'PAY-123' } }
  });
  assert.equal(ok, true);
});

test('refundPayment total envia body vacio', async () => {
  const refund = await refundPayment('PAY-1');
  assert.equal(refund.id, 'refund-1');
  assert.deepEqual(calls.refund, [{ payment_id: 'PAY-1', body: {} }]);
});

test('refundPayment parcial envia el monto', async () => {
  await refundPayment('PAY-1', '250.75');
  assert.deepEqual(calls.refund, [{ payment_id: 'PAY-1', body: { amount: 250.75 } }]);
});

test('searchPayments construye los filtros', async () => {
  await searchPayments({ external_reference: 'ORD-1', status: 'approved' });
  assert.deepEqual(calls.payment[0], {
    kind: 'search',
    options: {
      external_reference: 'ORD-1',
      status: 'approved'
    }
  });
});

test('searchPayments arma rango con begin/end_date', async () => {
  await searchPayments({ external_reference: 'ORD-2', range: { from: '2026-01-01', to: '2026-02-01' }, limit: 50 });
  assert.deepEqual(calls.payment[0], {
    kind: 'search',
    options: {
      external_reference: 'ORD-2',
      limit: 50,
      range: 'date_created',
      begin_date: '2026-01-01',
      end_date: '2026-02-01'
    }
  });
});
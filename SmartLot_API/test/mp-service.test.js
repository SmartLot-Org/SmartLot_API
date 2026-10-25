import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const calls = { preference: [], payment: [], merchantOrder: [], refund: [], failure: null };

mock.module('mercadopago', {
  namedExports: {
    MercadoPagoConfig: class {
      constructor(config) { this.config = config; }
    },
    Preference: class {
      constructor(client) { this.client = client; }
      async create({ body }) { calls.preference.push(body); if (calls.failure) throw calls.failure; return { id: 'pref-123', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref=123', sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref=123', external_reference: body.external_reference }; }
    },
    Payment: class {
      constructor(client) { this.client = client; }
      async get({ id }) { calls.payment.push({ kind: 'get', id }); if (calls.failure) throw calls.failure; return { id, status: 'approved', status_detail: 'accredited', payment_type_id: 'credit_card', transaction_amount: 100, currency_id: 'ARS', external_reference: 'ORD-1', preference_id: 'pref-123', date_approved: new Date().toISOString() }; }
      async search({ options }) { calls.payment.push({ kind: 'search', options }); if (calls.failure) throw calls.failure; return { results: [{ id: 'p-1' }] }; }
    },
    MerchantOrder: class {
      constructor(client) { this.client = client; }
      async get({ merchantOrderId }) {
        calls.merchantOrder.push(merchantOrderId);
        if (calls.failure) throw calls.failure;
        return { id: merchantOrderId, preference_id: 'pref-123', payments: [{ id: 123 }] };
      }
    },
    PaymentRefund: class {
      constructor(client) { this.client = client; }
      async create({ payment_id, body, requestOptions }) { calls.refund.push({ kind: 'partial', payment_id, body, requestOptions }); if (calls.failure) throw calls.failure; return { id: 'refund-1', status: 'approved', amount: body.amount }; }
      async total({ payment_id, requestOptions }) { calls.refund.push({ kind: 'total', payment_id, requestOptions }); if (calls.failure) throw calls.failure; return { id: 'refund-1', status: 'approved', amount: 100 }; }
    }
  }
});

const { createPreference, getMerchantOrder, getPayment, verifySignature, refundPayment, searchPayments, isSandbox } = await import('../src/services/mpService.js');

test.beforeEach(() => {
  calls.preference.length = 0;
  calls.payment.length = 0;
  calls.merchantOrder.length = 0;
  calls.refund.length = 0;
  calls.failure = null;
});

function computeSignature(dataId, requestId, ts, secret) {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

test('createPreference normaliza items y arma el body completo', async () => {
  delete process.env.MP_AUTO_RETURN;
  delete process.env.MP_SANDBOX;
  const originalFrontend = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://front.example';
  const result = await createPreference(
    [{ id: 5, title: 'Reserva garage', unit_price: 1500, quantity: 2 }],
    'ORD-42'
  );

  const body = calls.preference[0];
  assert.equal(result.id, 'pref-123');
  assert.equal(body.external_reference, 'ORD-42');
  assert.deepEqual(body.items, [{ id: 5, title: 'Reserva garage', description: '', quantity: 2, unit_price: 1500, currency_id: 'ARS' }]);
  assert.equal(Object.hasOwn(body, 'auto_return'), false);
  assert.equal(body.back_urls.success, 'https://front.example/payment/success');
  assert.equal(Object.hasOwn(body, 'notification_url'), false, 'no debe mandar notification_url cuando BACKEND_URL es localhost');
  if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = originalFrontend;
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
  const originalFrontend = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://front.example';
  process.env.MP_AUTO_RETURN = 'approved';
  await createPreference([{ title: 'x', unit_price: 100 }], 'ORD-1');
  assert.equal(calls.preference[0].auto_return, 'approved');
  delete process.env.MP_AUTO_RETURN;
  if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = originalFrontend;
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

test('verifySignature sin MP_WEBHOOK_SECRET rechaza cualquier request', () => {
  delete process.env.MP_WEBHOOK_SECRET;
  const ok = verifySignature({ headers: {}, query: {}, body: {} });
  assert.equal(ok, false);
});

test('verifySignature con secret: firma valida pasa', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  process.env.MP_WEBHOOK_SECRET = secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const dataId = 'PAY-123';
  const requestId = 'req-abc';
  const hash = computeSignature(dataId, requestId, ts, secret);

  const ok = verifySignature({
    headers: { 'x-signature': `ts=${ts}, v1=${hash}`, 'x-request-id': requestId },
    query: { 'data.id': dataId },
    body: { data: { id: dataId } }
  });
  assert.equal(ok, true);
});

test('verifySignature con secret: firma alterada se rechaza', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  process.env.MP_WEBHOOK_SECRET = secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const hash = computeSignature('PAY-123', 'req-abc', ts, secret);

  const ok = verifySignature({
    headers: { 'x-signature': `ts=${ts}, v1=${'0'.repeat(64)}`, 'x-request-id': 'req-abc' },
    query: { 'data.id': 'PAY-123' },
    body: { data: { id: 'PAY-123' } }
  });
  assert.equal(ok, false);
});

test('verifySignature con secret: falta de headers se rechaza', () => {
  process.env.MP_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
  assert.equal(verifySignature({ headers: {}, query: {}, body: {} }), false);
});

test('verifySignature con secret: falta data.id se rechaza', () => {
  const secret = crypto.randomBytes(32).toString('hex');
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

test('verifySignature exige data.id en query aunque exista en body', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  process.env.MP_WEBHOOK_SECRET = secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const hash = computeSignature('PAY-123', 'req-abc', ts, secret);

  const ok = verifySignature({
    headers: { 'x-signature': `ts=${ts}, v1=${hash}`, 'x-request-id': 'req-abc' },
    query: {},
    body: { data: { id: 'PAY-123' } }
  });
  assert.equal(ok, false);
});

test('verifySignature rechaza tipos de headers/query sin coerciones ni excepciones', () => {
  process.env.MP_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
  for (const value of [null, [], {}, 100, true]) {
    for (const field of ['x-signature', 'x-request-id', 'data.id']) {
      const req = {
        headers: { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': 'req-test' },
        query: { 'data.id': '100' }, body: { data: { id: '100' } }
      };
      if (field === 'data.id') req.query[field] = value;
      else req.headers[field] = value;
      assert.equal(verifySignature(req), false);
    }
  }
});

test('refundPayment total usa la operacion total e idempotencia', async () => {
  const refund = await refundPayment('PAY-1', undefined, 'refund-key');
  assert.equal(refund.id, 'refund-1');
  assert.deepEqual(calls.refund, [{ kind: 'total', payment_id: 'PAY-1', requestOptions: { idempotencyKey: 'refund-key' } }]);
});

test('getMerchantOrder resuelve la preferencia asociada al pago', async () => {
  const result = await getMerchantOrder('mo-123');
  assert.equal(result.preference_id, 'pref-123');
  assert.deepEqual(calls.merchantOrder, ['mo-123']);
});

test('refundPayment parcial envia el monto', async () => {
  await refundPayment('PAY-1', '250.75', 'refund-key');
  assert.deepEqual(calls.refund, [{ kind: 'partial', payment_id: 'PAY-1', body: { amount: 250.75 }, requestOptions: { idempotencyKey: 'refund-key' } }]);
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

// Los errores del SDK traen el status de Mercado Pago. Reenviarlo haría que un 401 del proveedor
// se lea como sesión vencida en el frontend, así que toda falla del proveedor es un 502 propio.
const esFallaDelProveedor = (error) => error.statusCode === 502 && error.code === 'MP_UPSTREAM_ERROR'
  && error.message === 'No se pudo completar la operación con Mercado Pago.';

for (const status of [400, 401, 403, 429, 500, 503]) {
  test(`un ${status} del SDK de Mercado Pago no se reenvía: todas las operaciones responden 502`, async () => {
    mock.method(console, 'error', () => {});
    try {
      calls.failure = { status, error: 'provider_error', message: 'detalle del proveedor' };
      await assert.rejects(createPreference([{ title: 'x', unit_price: 1 }], 'ORD-1'), esFallaDelProveedor);
      await assert.rejects(getPayment('123'), esFallaDelProveedor);
      await assert.rejects(searchPayments({ external_reference: 'ORD-1' }), esFallaDelProveedor);
      await assert.rejects(getMerchantOrder('55'), esFallaDelProveedor);
      await assert.rejects(refundPayment('123', undefined, 'key-1'), esFallaDelProveedor);
      await assert.rejects(refundPayment('123', 50, 'key-2'), esFallaDelProveedor);
    } finally { mock.restoreAll(); }
  });
}

test('una caída de red del SDK tambien es un 502 y conserva la causa original', async () => {
  mock.method(console, 'error', () => {});
  try {
    const original = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    calls.failure = original;
    await assert.rejects(getPayment('123'), (error) => esFallaDelProveedor(error) && error.cause === original);
  } finally { mock.restoreAll(); }
});

test('getPayment conserva el 404 propio cuando Mercado Pago no conoce el pago', async () => {
  calls.failure = { status: 404, error: 'not_found', message: 'Payment not found' };
  await assert.rejects(getPayment('999'), (error) => error.statusCode === 404
    && error.code === 'payment_not_found' && error.paymentId === '999');
});

test('el error del proveedor no filtra detalle al cliente: el errorHandler solo ve el mensaje genérico', async () => {
  mock.method(console, 'error', () => {});
  try {
    calls.failure = { status: 401, message: 'invalid access token APP_USR-secreto' };
    const error = await getPayment('123').catch((e) => e);
    assert.doesNotMatch(JSON.stringify({ message: error.message, code: error.code }), /APP_USR|secreto|401/);
  } finally { mock.restoreAll(); }
});

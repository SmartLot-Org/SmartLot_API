import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

const secret = crypto.randomBytes(32).toString('hex');
const state = { queries: [], providerCalls: [], events: new Map(), payments: new Map(), providerId: null };
mock.module('mercadopago', { namedExports: {
  MercadoPagoConfig: class {}, Preference: class {}, PaymentRefund: class {}, MerchantOrder: class {},
  Payment: class {
    async get({ id }) {
      state.providerCalls.push(id);
      return { id: state.providerId ?? id, status: 'approved', transaction_amount: 100, currency_id: 'ARS' };
    }
  }
} });
mock.module('../src/database/db.js', { defaultExport: {
  async query(sql, params = []) {
    state.queries.push({ sql, params });
    if (sql.includes('INSERT INTO webhook_eventos')) {
      if (!state.events.has(params[0])) state.events.set(params[0], { processed: false, payload: params[3] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE webhook_eventos')) {
      const event = state.events.get(params[1]);
      if (event) Object.assign(event, { processed: true, error: params[0] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('enterprise_payment_orders')) return { rows: [] };
    if (sql.includes('INSERT INTO pagos')) {
      // Simula la unicidad/upsert existente de mp_payment_id.
      state.payments.set(String(params[0]), params);
      return { rows: [{ id: 'local-payment' }], rowCount: 1 };
    }
    throw new Error(`SQL no previsto en el fixture: ${sql}`);
  }
} });
const { default: router } = await import('../src/controllers/paymentController.js');
const app = express();
app.use(express.json());
app.use('/api/payments', router);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.message }));
const path = '/api/payments/webhook';
const body = () => ({ id: 'existing-event', type: 'payment.updated', data: { id: '100' } });

function signature(id = '100', requestId = 'test-request', ts = String(Date.now())) {
  const hash = crypto.createHmac('sha256', secret)
    .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${hash}`;
}
function send({ payload = body(), query = { 'data.id': '100' }, sig = signature(), requestId = 'test-request' } = {}) {
  const req = request(app).post(path).query(query);
  if (sig !== null) req.set('x-signature', sig);
  if (requestId !== null) req.set('x-request-id', requestId);
  return req.send(payload);
}
function noEffects() {
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.queries.length, 0);
  assert.equal(state.payments.size, 0);
  assert.deepEqual(state.events.get('existing-event'), { processed: false, payload: 'previous' });
}
test.beforeEach(() => {
  process.env.MP_WEBHOOK_SECRET = secret;
  process.env.NODE_ENV = 'test';
  process.env.MP_SANDBOX = 'true';
  state.queries.length = state.providerCalls.length = 0;
  state.events.clear();
  state.events.set('existing-event', { processed: false, payload: 'previous' });
  state.payments.clear();
  state.providerId = null;
});

test('SEG-08: sin secreto rechaza HTTP sin firma antes de SQL/proveedor', async () => {
  delete process.env.MP_WEBHOOK_SECRET;
  const response = await send({ sig: null, requestId: null });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'Webhook temporarily unavailable' });
  noEffects();
});

test('SEG-08: firma de query 100 no autoriza procesar body 200', async () => {
  const response = await send({ payload: { ...body(), data: { id: '200' } } });
  assert.equal(response.status, 400);
  noEffects();
});

test('SEG-08: configuración obligatoria también en producción, desarrollo, test y sandbox', async () => {
  for (const env of ['production', 'development', 'test']) {
    for (const sandbox of ['true', 'false']) {
      for (const value of [undefined, '', '   ']) {
        process.env.NODE_ENV = env;
        process.env.MP_SANDBOX = sandbox;
        if (value === undefined) delete process.env.MP_WEBHOOK_SECRET;
        else process.env.MP_WEBHOOK_SECRET = value;
        assert.equal((await send()).status, 503, `${env}/${sandbox}/${JSON.stringify(value)}`);
        noEffects();
      }
    }
  }
});

test('SEG-08: firmas ausentes, incorrectas, truncadas o ambiguas no producen efectos', async () => {
  for (const sig of [null, '', 'ts', 'v1', 'ts=1,v1', 'ts=1,v1=ff', 'ts=no,v1=' + 'a'.repeat(64),
    'ts=1,v1=' + 'z'.repeat(64), 'ts=1,v1=' + '0'.repeat(64), `${signature()},ts=1`, `${signature()},${signature()}`]) {
    assert.equal((await send({ sig })).status, 400, String(sig));
    noEffects();
  }
  assert.equal((await send({ requestId: null })).status, 400);
  assert.equal((await send({ requestId: 'ambiguous;id:200' })).status, 400);
  noEffects();
});

test('SEG-08: campos requeridos y tipos inválidos se rechazan con 400 sin tocar evento existente', async () => {
  for (const payload of [
    {}, [], { ...body(), id: undefined }, { ...body(), id: [] }, { ...body(), id: {} },
    { ...body(), type: undefined }, { ...body(), type: [] }, { ...body(), data: undefined },
    { ...body(), data: [] }, { ...body(), data: { id: undefined } },
    ...[[], {}, null, true, 1.5, -1, Number.MAX_SAFE_INTEGER + 1, '', ' 100', '100;id:200'].map(id => ({ ...body(), data: { id } })),
  ]) {
    assert.equal((await send({ payload })).status, 400, JSON.stringify(payload));
    noEffects();
  }
  for (const query of [{}, { 'data.id': ['100', '200'] }, { 'data.id': '' }, { 'data.id[x]': '100' }]) {
    assert.equal((await send({ query })).status, 400, JSON.stringify(query));
    noEffects();
  }
});

test('SEG-08: ID de notificación no sustituye a data.id aunque tenga firma válida', async () => {
  const response = await send({ payload: { id: '100', type: 'payment.updated' }, query: {} });
  assert.equal(response.status, 400);
  noEffects();
});

test('SEG-08: firma válida consulta solo el recurso autenticado y repetir conserva upserts', async () => {
  const payload = { ...body(), data: { id: 100 } };
  for (let i = 0; i < 2; i++) {
    const response = await send({ payload });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { received: true });
  }
  assert.deepEqual(state.providerCalls.map(String), ['100', '100']);
  assert.equal(state.payments.size, 1);
  assert.equal(state.events.size, 1);
  assert.equal(state.events.get('existing-event').processed, true);
  assert.equal(state.events.get('existing-event').error, null);
});

test('SEG-08: ID contradictorio del proveedor conserva el rechazo 409 sin guardar pago', async () => {
  state.providerId = '200';
  assert.equal((await send()).status, 409);
  assert.deepEqual(state.providerCalls.map(String), ['100']);
  assert.equal(state.payments.size, 0);
  assert.equal(state.events.get('existing-event').processed, true);
  assert.match(state.events.get('existing-event').error, /Identidad de pago contradictoria/);
});

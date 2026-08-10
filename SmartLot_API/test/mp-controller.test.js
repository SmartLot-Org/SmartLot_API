import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

const state = {
  serviceCalls: [],
  queries: [],
  pgRow: { id: 'pago-1', mp_payment_id: 'PAY-1' },
  webhookValid: true,
  failNextSearch: false
};

mock.module('../src/services/mpService.js', {
  namedExports: {
    createPreference: async (items, orderId) => {
      state.serviceCalls.push(['createPreference', items, orderId]);
      return { id: 'pref-123', init_point: 'https://init.example/pref-123', sandbox_init_point: 'https://sandbox.example/pref-123' };
    },
    getPayment: async (paymentId) => {
      state.serviceCalls.push(['getPayment', paymentId]);
      return {
        id: paymentId,
        status: 'approved',
        status_detail: 'accredited',
        payment_type_id: 'credit_card',
        transaction_amount: 1500,
        currency_id: 'ARS',
        external_reference: 'ORD-42',
        preference_id: 'pref-123',
        date_approved: new Date().toISOString()
      };
    },
    verifySignature: () => state.webhookValid,
    refundPayment: async (paymentId, amount) => {
      state.serviceCalls.push(['refundPayment', paymentId, amount]);
      return { id: 'refund-1', status: 'approved', amount: amount ?? 1500 };
    },
    searchPayments: async (filters) => {
      state.serviceCalls.push(['searchPayments', filters]);
      if (state.failNextSearch) throw new Error('mp down');
      return { results: [{ id: 'PAY-1' }] };
    }
  }
});

mock.module('../src/database/db.js', {
  defaultExport: {
    query: async (sql, params = []) => {
      state.queries.push({ sql, params });
      return { rows: [state.pgRow] };
    }
  }
});

const { default: controller } = await import('../src/controllers/paymentController.js');

const app = express();
app.use(express.json());
app.use(controller);

test.beforeEach(() => {
  state.serviceCalls.length = 0;
  state.queries.length = 0;
  state.pgRow = { id: 'pago-1', mp_payment_id: 'PAY-1' };
  state.webhookValid = true;
});

function findQuery(sqlPart) {
  return state.queries.find((q) => q.sql.includes(sqlPart));
}

test('POST /preference sin items -> 400', async () => {
  const res = await request(app).post('/preference').send({ orderId: 'ORD-1' });
  assert.equal(res.status, 400);
  assert.equal(state.serviceCalls.length, 0);
});

test('POST /preference sin orderId -> 400', async () => {
  const res = await request(app).post('/preference').send({ items: [{ title: 'x', unit_price: 1 }] });
  assert.equal(res.status, 400);
});

test('POST /preference crea preferencia y guarda en pagos', async () => {
  const res = await request(app)
    .post('/preference')
    .send({ items: [{ id: 1, title: 'Reserva', unit_price: 750, quantity: 2 }], orderId: 'ORD-42' });

  assert.equal(res.status, 201);
  assert.deepEqual(res.body, {
    preferenceId: 'pref-123',
    initPoint: 'https://init.example/pref-123',
    sandboxInitPoint: 'https://sandbox.example/pref-123'
  });
  assert.deepEqual(state.serviceCalls[0], ['createPreference', [{ id: 1, title: 'Reserva', unit_price: 750, quantity: 2 }], 'ORD-42']);
  const insert = findQuery('INSERT INTO pagos');
  assert.ok(insert);
  assert.equal(insert.params[0], 'ORD-42');
  assert.equal(insert.params[2], 1500);
});

test('GET /:paymentId consulta y persiste el pago', async () => {
  const res = await request(app).get('/PAY-123');

  assert.equal(res.status, 200);
  assert.equal(res.body.payment.id, 'PAY-123');
  assert.equal(res.body.payment.status, 'approved');
  assert.equal(res.body.saved.mp_payment_id, 'PAY-1');
  assert.deepEqual(state.serviceCalls[0], ['getPayment', 'PAY-123']);
  assert.ok(findQuery('ON CONFLICT (mp_payment_id) DO UPDATE'));
});

test('POST /webhook con firma valida responde 200 y registra evento', async () => {
  const res = await request(app)
    .post('/webhook')
    .send({ id: 'evt-1', type: 'payment.updated', data: { id: 'PAY-123' } });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });
  assert.ok(findQuery('INSERT INTO webhook_eventos'));
  assert.ok(findQuery('UPDATE webhook_eventos'));
  assert.ok(findQuery('ON CONFLICT (mp_payment_id) DO UPDATE'));
});

test('POST /webhook con firma invalida -> 400 sin efectos', async () => {
  state.webhookValid = false;
  const res = await request(app)
    .post('/webhook')
    .send({ id: 'evt-2', type: 'payment.updated', data: { id: 'PAY-123' } });

  assert.equal(res.status, 400);
  assert.equal(state.queries.length, 0);
});

test('POST /webhook payment.refunded actualiza estado refunded', async () => {
  const res = await request(app)
    .post('/webhook')
    .send({ id: 'evt-3', type: 'payment.refunded', data: { id: 'PAY-123' } });

  assert.equal(res.status, 200);
  const update = findQuery('SET mp_payment_status = $1');
  assert.ok(update);
  assert.equal(update.params[0], 'refunded');
});

test('POST /:paymentId/refund reembolsa, inserta reembolso y actualiza estado', async () => {
  const res = await request(app)
    .post('/PAY-9/refund')
    .send({ amount: 500, motivo: 'Cliente cancelo' });

  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { refundId: 'refund-1', status: 'approved', amount: 500 });
  assert.deepEqual(state.serviceCalls[0], ['refundPayment', 'PAY-9', 500]);
  assert.deepEqual(state.serviceCalls[1], ['getPayment', 'PAY-9']);
  const insert = findQuery('INSERT INTO reembolsos');
  assert.ok(insert);
  assert.equal(insert.params[1], 500);
  assert.equal(insert.params[4], 'Cliente cancelo');
  const update = findQuery('SET mp_payment_status = $1');
  assert.ok(update);
  assert.equal(update.params[0], 'refunded');
});

test('POST /:paymentId/refund total (sin amount) usa monto del pago', async () => {
  const res = await request(app).post('/PAY-9/refund').send({});

  assert.equal(res.status, 201);
  assert.equal(res.body.amount, 1500);
  assert.deepEqual(state.serviceCalls[0], ['refundPayment', 'PAY-9', undefined]);
  const insert = findQuery('INSERT INTO reembolsos');
  assert.equal(insert.params[1], 1500);
  assert.equal(insert.params[4], 'Solicitado por usuario');
});

test('GET / pasa filtros de busqueda', async () => {
  const res = await request(app).get('/').query({ external_reference: 'ORD-1', status: 'approved', from: '2026-01-01', to: '2026-02-01' });

  assert.equal(res.status, 200);
  assert.deepEqual(state.serviceCalls[0], ['searchPayments', { external_reference: 'ORD-1', status: 'approved', range: { from: '2026-01-01', to: '2026-02-01' } }]);
});

test('GET / con error del servicio responde 500', async () => {
  state.failNextSearch = true;
  const res = await request(app).get('/');
  assert.equal(res.status, 500);
});
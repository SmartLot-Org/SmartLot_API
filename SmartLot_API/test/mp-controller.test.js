import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

const state = {
  serviceCalls: [],
  queries: [],
  pgRow: { id: 'pago-1', mp_payment_id: 'PAY-1' },
  webhookValid: true,
  failNextSearch: false,
  paymentOverrides: {}
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
        date_approved: new Date().toISOString(),
        ...state.paymentOverrides
      };
    },
    getMerchantOrder: async () => ({ preference_id: 'pref-123', external_reference: 'ORD-42', payments: [{ id: 'PAY-1' }] }),
    verifySignature: () => state.webhookValid,
    refundPayment: async (paymentId, amount) => {
      state.serviceCalls.push(['refundPayment', paymentId, amount]);
      return { id: 'refund-1', status: 'approved', amount: amount ?? 1500 };
    },
    searchPayments: async (filters) => {
      state.serviceCalls.push(['searchPayments', filters]);
      if (state.failNextSearch) throw new Error('mp down');
      return { results: [{ id: 'PAY-1' }] };
    },
    isSandbox: () => process.env.MP_SANDBOX === 'true' || process.env.MP_SANDBOX === '1'
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
  state.paymentOverrides = {};
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
    sandboxInitPoint: 'https://sandbox.example/pref-123',
    sandbox: false
  });
  assert.deepEqual(state.serviceCalls[0], ['createPreference', [{ id: 1, title: 'Reserva', unit_price: 750, quantity: 2 }], 'ORD-42']);
  const insert = findQuery('INSERT INTO pagos');
  assert.ok(insert);
  assert.equal(insert.params[0], 'ORD-42');
  assert.equal(insert.params[2], 1500);
});

test('POST /preference con MP_SANDBOX=true devuelve sandbox_init_point como initPoint', async () => {
  process.env.MP_SANDBOX = 'true';
  const res = await request(app)
    .post('/preference')
    .send({ items: [{ title: 'Reserva', unit_price: 100, quantity: 1 }], orderId: 'ORD-43' });

  assert.equal(res.status, 201);
  assert.equal(res.body.sandbox, true);
  assert.equal(res.body.initPoint, 'https://sandbox.example/pref-123');
  assert.equal(res.body.sandboxInitPoint, 'https://sandbox.example/pref-123');
  delete process.env.MP_SANDBOX;
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
  state.paymentOverrides = { transaction_amount_refunded: 1500 };
  const res = await request(app)
    .post('/webhook')
    .send({ id: 'evt-3', type: 'payment.refunded', data: { id: 'PAY-123' } });

  assert.equal(res.status, 200);
  const update = findQuery('SET mp_payment_status = $1');
  assert.ok(update);
  assert.equal(update.params[0], 'refunded');
});

test('POST /webhook payment.refunded conserva estado parcial cuando queda saldo', async () => {
  state.paymentOverrides = {
    transaction_amount: 1500,
    transaction_amount_refunded: 500,
    amount_refunded: 1500
  };
  const res = await request(app)
    .post('/webhook')
    .send({ id: 'evt-partial', type: 'payment.refunded', data: { id: 'PAY-123' } });

  assert.equal(res.status, 200);
  const update = findQuery('SET mp_payment_status = $1');
  assert.ok(update);
  assert.equal(update.params[0], 'partially_refunded');
});

test('POST /webhook no marca total si falta o contradice el acumulado reembolsado', async () => {
  for (const paymentOverrides of [
    {},
    { transaction_amount_refunded: null },
    { transaction_amount_refunded: 1501 }
  ]) {
    state.paymentOverrides = paymentOverrides;
    state.queries.length = 0;
    const res = await request(app)
      .post('/webhook')
      .send({ id: `evt-invalid-${state.queries.length}`, type: 'payment.refunded', data: { id: 'PAY-123' } });

    assert.equal(res.status, 409);
    assert.equal(findQuery('SET mp_payment_status = $1'), undefined);
  }
});

test('POST /webhook fallback considera solo refunds aprobados y evita duplicados', async () => {
  state.paymentOverrides = {
    refunds: [
      { id: 'r-1', status: 'approved', amount: 500 },
      { id: 'r-1', status: 'approved', amount: 500 },
      { id: 'r-2', status: 'pending', amount: 1000 }
    ]
  };
  const res = await request(app)
    .post('/webhook')
    .send({ id: 'evt-refunds-fallback', type: 'payment.refunded', data: { id: 'PAY-123' } });

  assert.equal(res.status, 200);
  assert.equal(findQuery('SET mp_payment_status = $1').params[0], 'partially_refunded');
});

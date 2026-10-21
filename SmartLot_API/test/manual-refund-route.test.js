import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = 'manual-refund-test-secret';

const PAYMENT_ID = '123456789';

const state = {
  users: new Map(),
  localPayment: null,
  refunds: [],
  providerPayment: null,
  refundResponse: null,
  providerError: null,
  serviceCalls: [],
  queries: [],
  writes: []
};

function validLocalPayment() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    id_reserva: 77,
    id_empresa: 10,
    id_orden_externa: 'ORD-42',
    mp_preference_id: 'pref-123',
    mp_payment_id: PAYMENT_ID,
    mp_payment_status: 'approved',
    monto: '1500.00',
    moneda: 'ARS',
    metadata: { id_reserva: 77 },
    linked_reservation_id: 77,
    reservation_company_id: 10,
    linked_company_id: 10
  };
}

function validProviderPayment(overrides = {}) {
  return {
    id: PAYMENT_ID,
    status: 'approved',
    transaction_amount: 1500,
    amount_refunded: 0,
    currency_id: 'ARS',
    external_reference: 'ORD-42',
    preference_id: 'pref-123',
    ...overrides
  };
}

function isWrite(sql) {
  return /^\s*(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)/i.test(sql);
}

async function query(sql, params = []) {
  state.queries.push({ sql, params });
  if (isWrite(sql)) state.writes.push({ sql, params });

  if (sql.includes('FROM usuarios u')) {
    const user = state.users.get(Number(params[0]));
    return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
  }
  if (sql.includes('FROM pagos p') && sql.includes('linked_reservation_id')) {
    return { rows: state.localPayment ? [state.localPayment] : [], rowCount: state.localPayment ? 1 : 0 };
  }
  if (sql.includes('FROM reembolsos')) {
    return { rows: [...state.refunds], rowCount: state.refunds.length };
  }
  if (sql.includes('FROM consumos_reserva')) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes('INSERT INTO reembolsos')) {
    const metadata = JSON.parse(params[6]);
    const existing = state.refunds.find((row) => row.mp_refund_id === params[1]);
    if (!existing) {
      state.refunds.unshift({
        id: `local-refund-${state.refunds.length + 1}`,
        id_pago: params[0],
        mp_refund_id: params[1],
        monto: params[2],
        moneda: params[3],
        estado: params[4],
        motivo: params[5],
        metadata,
        fecha_creacion: new Date().toISOString()
      });
    }
    return { rows: [], rowCount: existing ? 0 : 1 };
  }
  if (sql.includes('UPDATE pagos') && sql.includes('WHERE id = $3')) {
    if (state.localPayment) state.localPayment.mp_payment_status = params[0];
    return { rows: state.localPayment ? [{ id: state.localPayment.id }] : [], rowCount: state.localPayment ? 1 : 0 };
  }
  return { rows: [], rowCount: 0 };
}

const dbMock = {
  query,
  connect: async () => ({ query, release() {} })
};

mock.module('../src/database/db.js', { defaultExport: dbMock });
mock.module('../src/services/mpService.js', {
  namedExports: {
    createPreference: async () => ({ id: 'unused' }),
    getPayment: async (paymentId) => {
      state.serviceCalls.push(['getPayment', paymentId]);
      if (state.providerError) throw state.providerError;
      return state.providerPayment;
    },
    getMerchantOrder: async () => null,
    verifySignature: () => true,
    refundPayment: async (paymentId, amount, idempotencyKey) => {
      state.serviceCalls.push(['refundPayment', paymentId, amount, idempotencyKey]);
      if (state.providerError) throw state.providerError;
      return state.refundResponse;
    },
    searchPayments: async () => ({ results: [] }),
    isSandbox: () => true
  }
});

const { default: authMiddleware } = await import('../src/middlewares/authMiddleware.js');
const { default: paymentController } = await import('../src/controllers/paymentController.js');
const { default: errorHandler } = await import('../src/middlewares/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/payments', authMiddleware, paymentController);
app.use(errorHandler);

function tokenFor(id) {
  return jwt.sign({ id, id_rol: 4, tipo_rol: 'smartlot', id_empresa: 999 }, process.env.JWT_SECRET);
}

function asUser(id) {
  return { Authorization: `Bearer ${tokenFor(id)}` };
}

test.beforeEach(() => {
  state.users = new Map([
    [1, { id_rol: 1, id_empresa: 10, id_sede: 1, tipo_rol: 'admin', id_garage: null, id_garages: [] }],
    [2, { id_rol: 2, id_empresa: 10, id_sede: 1, tipo_rol: 'empleado', id_garage: null, id_garages: [] }],
    [3, { id_rol: 3, id_empresa: null, id_sede: null, tipo_rol: 'garagista', id_garage: 8, id_garages: [8] }],
    [4, { id_rol: 4, id_empresa: null, id_sede: null, tipo_rol: 'smartlot', id_garage: null, id_garages: [] }],
    [5, { id_rol: 5, id_empresa: null, id_sede: null, tipo_rol: 'dueño_garage', id_garage: 8, id_garages: [8] }],
    [6, { id_rol: 2, id_empresa: 20, id_sede: 2, tipo_rol: 'empleado', id_garage: null, id_garages: [] }]
  ]);
  state.localPayment = validLocalPayment();
  state.refunds = [];
  state.providerPayment = validProviderPayment();
  state.refundResponse = { id: 'refund-1', status: 'approved', amount: 1500 };
  state.providerError = null;
  state.serviceCalls.length = 0;
  state.queries.length = 0;
  state.writes.length = 0;
});

test('sin sesion responde 401 sin contactar Mercado Pago ni escribir', async () => {
  const res = await request(app).post(`/api/payments/${PAYMENT_ID}/refund`).send({});
  assert.equal(res.status, 401);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
});

for (const [id, role] of [[1, 'administrador'], [2, 'empleado'], [3, 'garagista'], [5, 'dueño de garage']]) {
  test(`${role} recibe 403 sin contactar Mercado Pago ni escribir`, async () => {
    const res = await request(app)
      .post(`/api/payments/${PAYMENT_ID}/refund`)
      .set(asUser(id))
      .send({});
    assert.equal(res.status, 403);
    assert.deepEqual(state.serviceCalls, []);
    assert.deepEqual(state.writes, []);
  });
}

test('empleado no puede reembolsar su propio pago', async () => {
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(2))
    .send({ usuarioId: 2, propietario: true });
  assert.equal(res.status, 403);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
});

test('usuario no puede reembolsar un pago ajeno', async () => {
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(6))
    .send({ usuarioId: 2 });
  assert.equal(res.status, 403);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
});

test('campos manipulados de rol, usuario y empresa no conceden permisos', async () => {
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund?rol=4&empresa=10`)
    .set({ ...asUser(2), 'x-user-role': 'smartlot', 'x-user-id': '4', 'x-company-id': '10' })
    .send({ id_rol: 4, tipo_rol: 'smartlot', usuario: 4, id_empresa: 10 });
  assert.equal(res.status, 403);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
});

test('superadmin con pago inexistente localmente recibe 404 sin contactar Mercado Pago ni escribir', async () => {
  state.localPayment = null;
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({});
  assert.equal(res.status, 404);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
});

test('identificador no numerico se rechaza antes de consultar datos o Mercado Pago', async () => {
  const res = await request(app)
    .post('/api/payments/not-a-payment/refund')
    .set(asUser(4))
    .send({});
  assert.equal(res.status, 400);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
  assert.equal(state.queries.filter((entry) => entry.sql.includes('FROM pagos p')).length, 0);
});

test('importe invalido se rechaza antes de solicitar el reembolso', async () => {
  for (const amount of [0, -1, 'no-numero', '10.999', null]) {
    state.serviceCalls.length = 0;
    state.writes.length = 0;
    const res = await request(app)
      .post(`/api/payments/${PAYMENT_ID}/refund`)
      .set(asUser(4))
      .send({ amount });
    assert.equal(res.status, 400, `amount=${String(amount)}`);
    assert.deepEqual(state.serviceCalls, []);
    assert.deepEqual(state.writes, []);
  }
});

test('superadmin puede reembolsar totalmente un pago valido y se registra el importe confirmado', async () => {
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({ motivo: 'Cancelacion manual' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { refundId: 'refund-1', status: 'approved', amount: 1500 });
  assert.deepEqual(state.serviceCalls[0], ['getPayment', PAYMENT_ID]);
  assert.equal(state.serviceCalls[1][0], 'refundPayment');
  assert.equal(state.serviceCalls[1][1], PAYMENT_ID);
  assert.equal(state.serviceCalls[1][2], undefined);
  assert.match(state.serviceCalls[1][3], /^[a-f0-9]{64}$/);
  const insert = state.writes.find((entry) => entry.sql.includes('INSERT INTO reembolsos'));
  assert.ok(insert);
  assert.equal(insert.params[2], 1500);
  assert.equal(insert.params[5], 'Cancelacion manual');
  const update = state.writes.find((entry) => entry.sql.includes('UPDATE pagos'));
  assert.equal(update.params[0], 'refunded');
  assert.equal(state.writes.some((entry) => entry.sql.includes('reservas')), false);
});

test('reembolso parcial no deja el pago registrado como total', async () => {
  state.refundResponse = { id: 'refund-partial', status: 'approved', amount: 500 };
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({ amount: 500 });
  assert.equal(res.status, 201);
  assert.equal(res.body.amount, 500);
  const update = state.writes.find((entry) => entry.sql.includes('UPDATE pagos'));
  assert.equal(update.params[0], 'partially_refunded');
  assert.equal(state.writes.some((entry) => entry.sql.includes('reservas')), false);
});

test('importe superior al saldo confiable se rechaza antes de solicitar el reembolso', async () => {
  state.providerPayment = validProviderPayment({ amount_refunded: 1200 });
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({ amount: 301 });
  assert.equal(res.status, 400);
  assert.deepEqual(state.serviceCalls, [['getPayment', PAYMENT_ID]]);
  assert.deepEqual(state.writes, []);
});

test('error del proveedor no informa ni persiste una devolucion exitosa', async () => {
  state.providerError = Object.assign(new Error('provider unavailable'), { statusCode: 503 });
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({});
  assert.equal(res.status, 503);
  assert.notEqual(res.body?.status, 'approved');
  assert.deepEqual(state.writes, []);
});

test('respuesta no confirmada del proveedor no se persiste como exitosa', async () => {
  state.refundResponse = { id: 'refund-pending', status: 'pending', amount: 1500 };
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({});
  assert.equal(res.status, 502);
  assert.deepEqual(state.writes, []);
});

test('reintento de una devolucion confirmada no llama otra vez a Mercado Pago', async () => {
  const first = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({ amount: 500 });
  assert.equal(first.status, 201);
  const callsAfterFirst = state.serviceCalls.length;
  const writesAfterFirst = state.writes.length;

  const second = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({ amount: 500 });
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.refundId, 'refund-1');
  assert.equal(state.serviceCalls.length, callsAfterFirst);
  assert.equal(state.writes.length, writesAfterFirst);
});

test('una relacion local contradictoria falla cerrada sin contactar Mercado Pago ni escribir', async () => {
  state.localPayment.metadata = { id_reserva: 999 };
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({});
  assert.equal(res.status, 409);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
});

test('un registro local sin relaciones ni correlacion con la preferencia se rechaza explicitamente', async () => {
  state.localPayment = {
    ...validLocalPayment(),
    id_reserva: null,
    linked_reservation_id: null,
    id_empresa: null,
    linked_company_id: null,
    mp_preference_id: null,
    id_orden_externa: null,
    metadata: {}
  };
  const res = await request(app)
    .post(`/api/payments/${PAYMENT_ID}/refund`)
    .set(asUser(4))
    .send({});
  assert.equal(res.status, 409);
  assert.deepEqual(state.serviceCalls, []);
  assert.deepEqual(state.writes, []);
});

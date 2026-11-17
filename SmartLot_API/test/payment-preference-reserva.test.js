import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.MP_WEBHOOK_SECRET = 'secreto-de-prueba';

const state = { queries: [], onQuery: async () => ({ rows: [], rowCount: 0 }), preferences: [] };

mock.module('../src/services/mpService.js', {
  namedExports: {
    createPreference: async (items, orderId) => { state.preferences.push(orderId); return { id: 'pref-1', init_point: 'https://init.example/pref-1' }; },
    getPayment: async () => ({}), getMerchantOrder: async () => ({}), verifySignature: () => true,
    refundPayment: async () => ({}), searchPayments: async () => ({ results: [] }), isSandbox: () => false,
  },
});
mock.module('../src/database/db.js', {
  defaultExport: { query: async (sql, params = []) => { state.queries.push({ sql, params }); return state.onQuery(sql, params); } },
});

const { default: controller } = await import('../src/controllers/paymentController.js');
const { default: errorHandler } = await import('../src/middlewares/errorHandler.js');

const empleado = { id: 7, id_rol: 2 };
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.usuario = empleado; next(); });
app.use(controller);
app.use(errorHandler);

test.beforeEach(() => {
  state.queries.length = 0;
  state.preferences.length = 0;
  state.onQuery = async () => ({ rows: [], rowCount: 0 });
});

test('una reserva con la retención vencida responde 409 RESERVATION_HOLD_EXPIRED', async () => {
  state.onQuery = async (sql) => sql.includes("SET estado_reserva='expirada'") ? { rows: [{ id: 5 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  const res = await request(app).post('/preference').send({ idReserva: 5 });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'RESERVATION_HOLD_EXPIRED');
  assert.equal(state.preferences.length, 0);
});

test('solo se expira una reserva propia: el UPDATE filtra por el empleado', async () => {
  await request(app).post('/preference').send({ idReserva: 5 });
  const update = state.queries.find((q) => q.sql.includes("SET estado_reserva='expirada'"));

  assert.match(update.sql, /id_usuario=\$2/);
  assert.deepEqual(update.params, [5, 7]);
});

test('una reserva inexistente o ajena responde 404 sin revelar cuál de las dos es', async () => {
  const res = await request(app).post('/preference').send({ idReserva: 5 });

  assert.equal(res.status, 404);
  assert.equal(res.body.message, 'La reserva no existe.');
});

test('una reserva propia ya pagada responde 409', async () => {
  state.onQuery = async (sql) => sql.includes('SELECT r.* FROM reservas r')
    ? { rows: [{ id: 5, estado_reserva: 'confirmada', importe_estimado: 1000 }], rowCount: 1 }
    : { rows: [], rowCount: 0 };
  const res = await request(app).post('/preference').send({ idReserva: 5 });

  assert.equal(res.status, 409);
  assert.equal(res.body.message, 'La reserva no está pendiente de pago.');
});

import { randomBytes } from 'node:crypto';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'seg-02-test-secret';

// El endpoint requiere configuración incluso cuando esta suite simula el servicio MP.
process.env.MP_WEBHOOK_SECRET = randomBytes(32).toString('hex');

const users = new Map([
  [1, { id_rol: 1, id_empresa: 10, id_sede: null, tipo_rol: 'admin' }],
  [8, { id_rol: 1, id_empresa: 10, id_sede: 101, tipo_rol: 'admin' }],
  [2, { id_rol: 2, id_empresa: 10, id_sede: 101, tipo_rol: 'empleado' }],
  [7, { id_rol: 2, id_empresa: 10, id_sede: 101, tipo_rol: 'empleado' }],
  [9, { id_rol: 2, id_empresa: 10, id_sede: 102, tipo_rol: 'empleado' }],
  [10, { id_rol: 2, id_empresa: 20, id_sede: 201, tipo_rol: 'empleado' }],
  [3, { id_rol: 3, id_empresa: null, id_sede: null, tipo_rol: 'garagista', id_garage: 30 }],
  [4, { id_rol: 4, id_empresa: null, id_sede: null, tipo_rol: 'smartlot' }],
  [5, { id_rol: 5, id_empresa: null, id_sede: null, tipo_rol: 'dueño_garage', id_garage: 30 }]
]);

const basePayments = [
  payment({ id: 'local-100', mp: '100', reference: 'A-OWN', preference: 'pref-100', amount: 100, owner: 2, company: 10, site: 101 }),
  payment({ id: 'local-101', mp: '101', reference: 'A-OTHER', preference: 'pref-101', amount: 110, owner: 7, company: 10, site: 101 }),
  payment({ id: 'local-102', mp: '102', reference: 'A-SITE-2', preference: 'pref-102', amount: 120, owner: 9, company: 10, site: 102 }),
  payment({ id: 'local-200', mp: '200', reference: 'B-PAY', preference: 'pref-200', amount: 200, owner: 10, company: 20, site: 201 }),
  payment({ id: 'local-300', mp: '300', reference: 'A-GROUP', preference: 'pref-300', amount: 300, company: 10, sites: [101], kind: 'grouped' }),
  payment({ id: 'local-301', mp: '301', reference: 'A-MIXED', preference: 'pref-301', amount: 310, company: 10, sites: [101, 102], kind: 'grouped' }),
  payment({ id: 'local-900', mp: '900', reference: null, preference: null, amount: 900, coherent: false }),
  payment({ id: 'local-901', mp: '901', reference: 'CONFLICT', preference: 'pref-901', amount: 901, company: 10, site: 101, owner: 2, coherent: false }),
  payment({ id: 'pending-employee', mp: null, reference: 'reserva-50', preference: 'pref-employee', amount: 50, owner: 2, company: 10, site: 101 }),
  payment({ id: 'pending-admin', mp: null, reference: 'ADMIN-A-PENDING', preference: 'pref-admin', amount: 60, company: 10, sites: [101], kind: 'grouped' })
];

const baseProviderPayments = [
  ...basePayments.filter((p) => p.mp_payment_id).map(providerFromLocal),
  providerFromLocal({ ...basePayments.find((p) => p.id === 'pending-employee'), mp_payment_id: '500' }),
  providerFromLocal({ ...basePayments.find((p) => p.id === 'pending-admin'), mp_payment_id: '600' })
];

const state = {
  payments: [],
  providerPayments: [],
  providerCalls: [],
  writes: [],
  queries: [],
  webhookValid: true
};

function payment({ id, mp, reference, preference, amount, owner = null, company = null, site = null, sites = null, kind = 'reservation', coherent = true }) {
  return {
    id,
    id_reserva: kind === 'reservation' ? Number(id.replace(/\D/g, '')) || 1 : null,
    id_orden_externa: reference,
    mp_preference_id: preference,
    mp_payment_id: mp,
    mp_payment_status: 'approved',
    mp_payment_type: 'credit_card',
    monto: amount,
    moneda: 'ARS',
    descripcion: `Pago ${id}`,
    fecha_creacion: '2026-10-01T12:00:00.000Z',
    fecha_actualizacion: '2026-10-01T12:00:00.000Z',
    fecha_aprobacion: mp ? '2026-10-01T12:01:00.000Z' : null,
    ownership_kind: kind,
    resolved_company_id: company,
    resolved_site_id: sites?.length === 1 ? sites[0] : site,
    owner,
    company,
    site,
    sites: sites || (site ? [site] : []),
    coherent,
    metadata: { private_token: 'no-exponer', payer_email: 'privado@example.com' }
  };
}

function providerFromLocal(local) {
  return {
    id: String(local.mp_payment_id),
    status: local.mp_payment_status,
    status_detail: 'accredited',
    payment_type_id: local.mp_payment_type,
    transaction_amount: local.monto,
    currency_id: local.moneda,
    description: local.descripcion,
    date_approved: local.fecha_aprobacion || '2026-10-01T12:01:00.000Z',
    date_created: local.fecha_creacion,
    external_reference: local.id_orden_externa,
    order: { id: `merchant-${local.mp_payment_id}` },
    _expectedPreferenceId: local.mp_preference_id,
    payer: { email: 'privado@example.com' },
    metadata: { private_token: 'no-exponer' }
  };
}

function clone(value) {
  return structuredClone(value);
}

function authorized(local, role, userId, companyId, siteId) {
  if (!local.coherent) return false;
  if (role === 4) return true;
  if (role === 2) return local.ownership_kind === 'reservation' && local.owner === userId;
  if (role !== 1 || !['reservation', 'grouped'].includes(local.ownership_kind) || local.company !== companyId) return false;
  if (siteId === null || siteId === undefined) return true;
  if (local.ownership_kind === 'grouped') return local.sites.length === 1 && local.sites[0] === siteId;
  return local.site === siteId;
}

function scoped(params) {
  const [role, userId, companyId, siteId] = params;
  return state.payments.filter((p) => authorized(p, role, userId, companyId, siteId));
}

function applySqlFilters(sql, params, rows) {
  let next = rows.filter((p) => p.mp_payment_id !== null);
  const referenceMatch = sql.match(/ap\.id_orden_externa = \$(\d+)/);
  const statusMatch = sql.match(/ap\.mp_payment_status = \$(\d+)/);
  if (referenceMatch) next = next.filter((p) => p.id_orden_externa === params[Number(referenceMatch[1]) - 1]);
  if (statusMatch) next = next.filter((p) => p.mp_payment_status === params[Number(statusMatch[1]) - 1]);
  return next;
}

mock.module('../src/services/mpService.js', {
  namedExports: {
    createPreference: async () => ({ id: 'pref-new' }),
    getPayment: async (id) => {
      state.providerCalls.push(['getPayment', String(id)]);
      const found = state.providerPayments.find((p) => String(p.id) === String(id));
      if (!found) {
        const error = new Error('not found'); error.statusCode = 404; error.code = 'payment_not_found'; throw error;
      }
      return clone(found);
    },
    getMerchantOrder: async (id) => {
      state.providerCalls.push(['getMerchantOrder', String(id)]);
      const payment = state.providerPayments.find((item) => String(item.order?.id) === String(id));
      return payment ? {
        id,
        preference_id: payment._expectedPreferenceId,
        external_reference: payment.external_reference,
        payments: [{ id: payment.id }]
      } : null;
    },
    searchPayments: async (filters) => {
      state.providerCalls.push(['searchPayments', clone(filters)]);
      return { results: state.providerPayments.filter((p) => p.external_reference === filters.external_reference).map(clone) };
    },
    verifySignature: () => state.webhookValid,
    refundPayment: async () => ({ id: 'refund-unused' }),
    isSandbox: () => false
  }
});

mock.module('../src/database/db.js', {
  defaultExport: {
    query: async (sql, params = []) => {
      state.queries.push({ sql, params: clone(params) });
      if (sql.includes('FROM usuarios u') && sql.includes('INNER JOIN roles')) {
        const user = users.get(Number(params[0]));
        return { rows: user ? [{ ...user, id_garage: user.id_garage ?? null, id_garages: user.id_garage ? [user.id_garage] : [] }] : [], rowCount: user ? 1 : 0 };
      }
      if (sql.includes('payment_access:reference_candidates')) {
        let rows = scoped(params).filter((p) => p.id_orden_externa === params[4]);
        if (params[5]) rows = rows.filter((p) => p.mp_preference_id === params[5]);
        return { rows: rows.slice(0, 3).map(clone), rowCount: rows.length };
      }
      if (sql.includes('payment_access:detail')) {
        const row = scoped(params).find((p) => String(p.mp_payment_id) === String(params[4]));
        return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('payment_access:sync_authorized')) {
        const local = state.payments.find((p) => p.id === params[8]
          && p.mp_preference_id === params[9]
          && p.id_orden_externa === params[10]
          && p.mp_payment_id === params[11]);
        if (!local) return { rows: [], rowCount: 0 };
        state.writes.push({ sql, params: clone(params) });
        Object.assign(local, {
          mp_payment_id: params[0], mp_payment_status: params[1], mp_payment_type: params[2],
          monto: params[3] ?? local.monto, moneda: params[4] ?? local.moneda, fecha_aprobacion: params[6]
        });
        return { rows: [{ id: local.id }], rowCount: 1 };
      }
      if (sql.includes('payment_access:list_aggregate')) {
        const rows = applySqlFilters(sql, params, scoped(params));
        return { rows: [{ total: rows.length, total_amount: String(rows.reduce((sum, p) => sum + p.monto, 0)) }], rowCount: 1 };
      }
      if (sql.includes('payment_access:list')) {
        const rows = applySqlFilters(sql, params, scoped(params));
        const limit = Number(params.at(-2));
        const offset = Number(params.at(-1));
        return { rows: rows.slice(offset, offset + limit).map(clone), rowCount: rows.length };
      }
      if (sql.includes('payment_access:webhook_events')) {
        return { rows: [{ mp_event_id: 'evt-1', tipo_evento: 'payment.updated', mp_payment_id: '100', firma_valida: true, procesado: true, error_procesamiento: 'Authorization: Bearer supersecreto access_token=otro-secreto fallo proveedor', fecha_recepcion: '2026-10-01', fecha_procesamiento: '2026-10-01' }], rowCount: 1 };
      }
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) state.writes.push({ sql, params: clone(params) });
      if (sql.includes('INSERT INTO webhook_eventos')) return { rows: [{ id: 'webhook-row' }], rowCount: 1 };
      if (sql.includes('SELECT id, metadata, mp_payment_id')) return { rows: [], rowCount: 0 };
      if (sql.includes('ON CONFLICT (mp_payment_id)')) return { rows: [{ id: 'webhook-payment' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  }
});

const { default: authMiddleware } = await import('../src/middlewares/authMiddleware.js');
const { default: paymentController } = await import('../src/controllers/paymentController.js');

const app = express();
app.use(express.json());
app.use('/api/payments', (req, res, next) => {
  if (req.path === '/webhook' && req.method === 'POST') return next();
  return authMiddleware(req, res, next);
}, paymentController);
app.use((error, _req, res, _next) => {
  res.status(error.statusCode || 500).json({ error: true, code: error.code, message: error.message, statusCode: error.statusCode || 500 });
});

function token(id, overrides = {}) {
  return jwt.sign({ id, ...overrides }, process.env.JWT_SECRET);
}

function get(path, userId, query) {
  let call = request(app).get(path);
  if (userId) call = call.set('Authorization', `Bearer ${token(userId)}`);
  if (query) call = call.query(query);
  return call;
}

function post(path, userId, body = {}) {
  let call = request(app).post(path);
  if (userId) call = call.set('Authorization', `Bearer ${token(userId)}`);
  return call.send(body);
}

const writesToPagos = () => state.queries.filter((q) => /^\s*(\/\*[^*]*\*\/\s*)?(INSERT INTO|UPDATE|DELETE FROM)\s+pagos\b/i.test(q.sql));

test.beforeEach(() => {
  state.payments = clone(basePayments);
  state.providerPayments = clone(baseProviderPayments);
  state.providerCalls.length = 0;
  state.writes.length = 0;
  state.queries.length = 0;
  state.webhookValid = true;
});

test('las consultas protegidas sin sesion responden 401', async () => {
  for (const path of ['/api/payments', '/api/payments/100', '/api/payments/webhook-events']) {
    const response = await get(path);
    assert.equal(response.status, 401, path);
  }
  for (const path of ['/api/payments/verificar', '/api/payments/100/verificar']) {
    const response = await post(path);
    assert.equal(response.status, 401, path);
  }
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.writes.length, 0);
});

test('superadmin lista globalmente pagos coherentes y consulta webhooks sin payload', async () => {
  const list = await get('/api/payments', 4);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.results.map((p) => p.id).sort(), ['100', '101', '102', '200', '300', '301']);
  assert.equal(list.body.paging.total, 6);
  assert.equal(list.body.totals.amount, 1140);

  const events = await get('/api/payments/webhook-events', 4);
  assert.equal(events.status, 200);
  assert.equal(events.body.eventos.length, 1);
  assert.equal(Object.hasOwn(events.body.eventos[0], 'payload'), false);
  assert.doesNotMatch(events.body.eventos[0].error_procesamiento, /supersecreto|otro-secreto/);
});

test('admin de A no obtiene pagos de B por listado, id ni referencia', async () => {
  const list = await get('/api/payments', 1);
  assert.equal(list.status, 200);
  assert.equal(list.body.results.some((p) => p.id === '200'), false);

  const byId = await get('/api/payments/200', 1);
  assert.equal(byId.status, 404);
  const byReference = await get('/api/payments', 1, { external_reference: 'B-PAY' });
  assert.equal(byReference.status, 200);
  assert.deepEqual(byReference.body.results, []);
  assert.equal(byReference.body.paging.total, 0);
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.writes.length, 0);
});

test('admin restringido a sede no accede a otra sede ni a un pago agrupado mixto', async () => {
  const list = await get('/api/payments', 8);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.results.map((p) => p.id).sort(), ['100', '101', '300']);
  assert.equal((await get('/api/payments/102', 8)).status, 404);
  assert.equal((await get('/api/payments/301', 8)).status, 404);
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.writes.length, 0);
});

test('empleado accede a su pago pero no al de otro empleado de la misma sede', async () => {
  const list = await get('/api/payments', 2);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.results.map((p) => p.id), ['100']);

  const own = await get('/api/payments/100', 2);
  assert.equal(own.status, 200);
  assert.equal(own.body.payment.id, '100');
  assert.equal(Object.hasOwn(own.body, 'saved'), false);
  const foreign = await get('/api/payments/101', 2);
  assert.equal(foreign.status, 404);
});

test('dueño y garagista reciben 403 antes de consultar datos o proveedor', async () => {
  for (const id of [3, 5]) {
    for (const path of ['/api/payments', '/api/payments/100']) {
      const response = await get(path, id);
      assert.equal(response.status, 403, `${id} ${path}`);
    }
    for (const path of ['/api/payments/verificar', '/api/payments/100/verificar']) {
      const response = await post(path, id, { externalReference: 'A-OWN' });
      assert.equal(response.status, 403, `${id} ${path}`);
    }
  }
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.writes.length, 0);
});

test('historial de webhooks es 403 para todos salvo superadmin', async () => {
  for (const id of [1, 8, 2, 7, 3, 5]) {
    const response = await get('/api/payments/webhook-events', id);
    assert.equal(response.status, 403, String(id));
  }
  assert.equal(state.queries.some((q) => q.sql.includes('payment_access:webhook_events')), false);
});

test('historial de webhooks valida filtros y limita el maximo antes de consultar', async () => {
  assert.equal((await get('/api/payments/webhook-events', 4, { procesado: 'tal-vez' })).status, 400);
  assert.equal((await get('/api/payments/webhook-events', 4, { limite: 101 })).status, 400);
  assert.equal(state.queries.some((q) => q.sql.includes('payment_access:webhook_events')), false);

  const valid = await get('/api/payments/webhook-events', 4, { procesado: 'false', limite: 25 });
  assert.equal(valid.status, 200);
  const query = state.queries.find((q) => q.sql.includes('payment_access:webhook_events'));
  assert.deepEqual(query.params, [false, 25]);
});

test('campos de rol, usuario, empresa y sede del cliente no amplian el alcance', async () => {
  const response = await get('/api/payments', 2, {
    id_rol: 4, id_usuario: 7, id_empresa: 20, id_sede: 201, usuario: 4
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results.map((p) => p.id), ['100']);
  const authParams = state.queries.find((q) => q.sql.includes('payment_access:list_aggregate')).params.slice(0, 4);
  assert.deepEqual(authParams, [2, 2, 10, 101]);
});

test('conteos, totales y paginacion se calculan solo sobre pagos autorizados', async () => {
  const response = await get('/api/payments', 1, { limit: 2, offset: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.body.results.length, 2);
  assert.deepEqual(response.body.paging, { total: 5, limit: 2, offset: 1 });
  assert.equal(response.body.totals.amount, 940);
});

test('registros huerfanos o contradictorios no abren acceso', async () => {
  for (const id of ['900', '901']) {
    assert.equal((await get(`/api/payments/${id}`, 4)).status, 404);
  }
  const list = await get('/api/payments', 4);
  assert.equal(list.body.results.some((p) => ['900', '901'].includes(p.id)), false);
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.writes.length, 0);
});

test('respuestas de pagos permitidas usan allowlist y omiten metadata, pagador y fila saved', async () => {
  const detail = await get('/api/payments/100', 4);
  assert.equal(detail.status, 200);
  assert.equal(Object.hasOwn(detail.body, 'saved'), false);
  assert.equal(Object.hasOwn(detail.body.payment, 'metadata'), false);
  assert.equal(Object.hasOwn(detail.body.payment, 'payer'), false);
  assert.equal(Object.hasOwn(detail.body.payment, 'payer_email'), false);
  const list = await get('/api/payments', 4);
  assert.equal(Object.hasOwn(list.body.results[0], 'metadata'), false);
});

test('empleado verifica pago propio tras checkout antes del webhook usando preferencia local', async () => {
  const response = await post('/api/payments/500/verificar', 2, {
    externalReference: 'reserva-50', preferenceId: 'pref-employee'
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.payment.id, '500');
  assert.deepEqual(state.providerCalls, [['getPayment', '500'], ['getMerchantOrder', 'merchant-500']]);
  assert.equal(state.writes.length, 1);
  assert.equal(state.payments.find((p) => p.id === 'pending-employee').mp_payment_id, '500');
});

test('empleado consulta pago historico propio con preferencia nula sin abrir el ajeno', async () => {
  const historical = state.payments.find((p) => p.id === 'local-100');
  historical.mp_preference_id = null;
  const provider = state.providerPayments.find((p) => p.id === '100');
  provider._expectedPreferenceId = null;

  const own = await post('/api/payments/100/verificar', 2);
  assert.equal(own.status, 200);
  assert.equal(own.body.payment.id, '100');
  assert.deepEqual(state.providerCalls, [['getPayment', '100']]);
  assert.equal(state.writes.length, 1);

  state.providerCalls.length = 0;
  state.writes.length = 0;
  const foreign = await post('/api/payments/100/verificar', 7);
  assert.equal(foreign.status, 404);
  assert.deepEqual(state.providerCalls, []);
  assert.deepEqual(state.writes, []);
});

test('admin verifica pago agrupado autorizado por referencia antes del webhook', async () => {
  const response = await post('/api/payments/verificar', 8, { externalReference: 'ADMIN-A-PENDING' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results.map((p) => p.id), ['600']);
  assert.deepEqual(state.providerCalls, [
    ['searchPayments', { external_reference: 'ADMIN-A-PENDING' }],
    ['getMerchantOrder', 'merchant-600']
  ]);
  assert.equal(state.writes.length, 1);
});

test('referencia ajena o detalle ajeno no consulta proveedor ni escribe', async () => {
  assert.equal((await get('/api/payments/200', 2)).status, 404);
  assert.equal((await post('/api/payments/200/verificar', 2)).status, 404);
  const search = await post('/api/payments/verificar', 2, { externalReference: 'B-PAY' });
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.results, []);
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.writes.length, 0);
});

test('una asociacion contradictoria devuelta por el proveedor no se persiste como valida', async () => {
  const providerPayment = state.providerPayments.find((p) => p.id === '100');
  providerPayment._expectedPreferenceId = 'pref-otra';
  const response = await post('/api/payments/100/verificar', 2);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'payment_reference_conflict');
  assert.deepEqual(state.providerCalls, [['getPayment', '100'], ['getMerchantOrder', 'merchant-100']]);
  assert.equal(state.writes.length, 0);
});

test('una referencia local autorizada ambigua se rechaza antes de consultar al proveedor', async () => {
  const duplicate = clone(state.payments.find((p) => p.id === 'pending-admin'));
  duplicate.id = 'pending-admin-duplicate';
  duplicate.mp_preference_id = 'pref-admin-duplicate';
  state.payments.push(duplicate);
  const response = await post('/api/payments/verificar', 1, { externalReference: 'ADMIN-A-PENDING' });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'ambiguous_payment_reference');
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.writes.length, 0);
});

test('POST webhook conserva el flujo publico y la verificacion de firma', async () => {
  state.webhookValid = false;
  const denied = await request(app).post('/api/payments/webhook').send({ id: 'evt-denied', type: 'payment.updated', data: { id: '100' } });
  assert.equal(denied.status, 401);
  assert.equal(state.writes.length, 0);

  state.webhookValid = true;
  const accepted = await request(app).post('/api/payments/webhook').send({ id: 'evt-ok', type: 'other', data: { id: '100' } });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { received: true });
  assert.equal(state.writes.length, 2);
});

test('ningún GET consulta a Mercado Pago ni escribe en pagos', async () => {
  const requests = [
    get('/api/payments', 4),
    get('/api/payments/100', 4),
    get('/api/payments/100', 2),
    get('/api/payments', 8, { external_reference: 'ADMIN-A-PENDING' }),
    get('/api/payments', 2, { external_reference: 'reserva-50', preference_id: 'pref-employee' }),
    get('/api/payments/500', 2, { external_reference: 'reserva-50', preference_id: 'pref-employee' }),
  ];
  for (const pending of requests) await pending;
  assert.deepEqual(state.providerCalls, []);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(writesToPagos(), []);
});

test('GET por id lee el estado local autorizado sin sincronizar', async () => {
  const response = await get('/api/payments/100', 2);
  assert.equal(response.status, 200);
  assert.equal(response.body.payment.id, '100');
  assert.equal(response.body.payment.status, 'approved');
  assert.equal(response.body.payment.statusDetail, null);
});

test('GET de un pago aún no sincronizado responde 404 y deja la verificación al POST', async () => {
  // El pago 500 existe en el proveedor, pero el registro local todavía no tiene mp_payment_id.
  const pending = await get('/api/payments/500', 2, { external_reference: 'reserva-50', preference_id: 'pref-employee' });
  assert.equal(pending.status, 404);
  assert.equal(pending.body.code, 'payment_not_found');
  assert.deepEqual(state.providerCalls, []);

  const verified = await post('/api/payments/500/verificar', 2, { externalReference: 'reserva-50', preferenceId: 'pref-employee' });
  assert.equal(verified.status, 200);
  assert.equal((await get('/api/payments/500', 2)).status, 200);
});

test('GET /api/payments con external_reference solo filtra el listado local', async () => {
  const response = await get('/api/payments', 8, { external_reference: 'ADMIN-A-PENDING' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results, []);
  assert.deepEqual(state.providerCalls, []);
  assert.equal(state.writes.length, 0);
});

test('POST verificar valida su entrada antes de consultar al proveedor', async () => {
  const sinReferencia = await post('/api/payments/verificar', 4, {});
  assert.equal(sinReferencia.status, 400);
  assert.equal(sinReferencia.body.message, 'externalReference es requerido.');
  assert.equal((await post('/api/payments/verificar', 4, { externalReference: ['A', 'B'] })).status, 400);
  const idInvalido = await post('/api/payments/abc/verificar', 4);
  assert.equal(idInvalido.status, 400);
  assert.equal(idInvalido.body.code, 'invalid_payment_id');
  assert.deepEqual(state.providerCalls, []);
  assert.equal(state.writes.length, 0);
});

test('POST verificar de un pago que el proveedor no conoce responde 404 sin detalle del proveedor', async () => {
  state.providerPayments = [];
  const response = await post('/api/payments/100/verificar', 4);
  assert.equal(response.status, 404);
  assert.equal(response.body.message, 'Pago no encontrado.');
  assert.equal(response.body.code, 'payment_not_found');
  assert.equal(state.writes.length, 0);
});

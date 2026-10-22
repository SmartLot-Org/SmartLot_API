import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const providerCalls = [];
const writes = [];

const providerPayments = new Map([
  ['100', {
    id: '100',
    status: 'approved',
    payment_type_id: 'credit_card',
    transaction_amount: 100,
    transaction_amount_refunded: 0,
    currency_id: 'ARS',
    external_reference: 'A-HISTORY',
    date_approved: '2026-10-01T12:01:00.000Z'
  }]
]);

const sqlPool = {
  query: async (sql, params = []) => {
    if (sql.includes('payment_access:sync_authorized')) writes.push({ sql, params: structuredClone(params) });
    return db.query(sql, params);
  }
};

mock.module('../src/database/db.js', { defaultExport: sqlPool });
mock.module('../src/services/mpService.js', {
  namedExports: {
    getPayment: async (id) => {
      providerCalls.push(['getPayment', String(id)]);
      return structuredClone(providerPayments.get(String(id)));
    },
    getMerchantOrder: async (id) => {
      providerCalls.push(['getMerchantOrder', String(id)]);
      return null;
    },
    searchPayments: async (filters) => {
      providerCalls.push(['searchPayments', structuredClone(filters)]);
      return { results: [] };
    }
  }
});

const { getAuthorizedPayment, listAuthorizedPayments } = await import('../src/services/paymentReadService.js');

const USERS = {
  adminA: { id: 1, id_rol: 1, id_empresa: 10, id_sede: null },
  adminSiteA: { id: 8, id_rol: 1, id_empresa: 10, id_sede: 101 },
  employeeA: { id: 2, id_rol: 2, id_empresa: 10, id_sede: 101 },
  employeeSameSite: { id: 7, id_rol: 2, id_empresa: 10, id_sede: 101 },
  superadmin: { id: 4, id_rol: 4, id_empresa: null, id_sede: null }
};

function uuid(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

async function insertPayment({ number, reservationId = null, reference, preference = null, mp, amount, company, metadata }) {
  await db.query(
    `INSERT INTO pagos (
       id, id_reserva, id_orden_externa, mp_preference_id, mp_payment_id,
       mp_payment_status, mp_payment_type, monto, moneda, descripcion,
       fecha_creacion, fecha_actualizacion, fecha_aprobacion, metadata, id_empresa
     ) VALUES ($1, $2, $3, $4, $5, 'approved', 'credit_card', $6, 'ARS', $7,
               '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z', '2026-10-01T12:01:00Z', $8::jsonb, $9)`,
    [uuid(number), reservationId, reference, preference, String(mp), amount, `Pago ${mp}`, JSON.stringify(metadata), company]
  );
}

test.before(async () => {
  await db.exec(`
    CREATE TABLE enterprise_payment_orders(reference text, payment_id text, preference_id text);
    CREATE TABLE usuarios (id integer PRIMARY KEY, id_empresa integer);
    CREATE TABLE sedes (id integer PRIMARY KEY, id_empresa integer);
    CREATE TABLE trato_empresa_garage (id bigint PRIMARY KEY, id_sede integer);
    CREATE TABLE reservas (id integer PRIMARY KEY, id_usuario integer, id_trato bigint);
    CREATE TABLE consumos_reserva (
      id bigint PRIMARY KEY,
      id_reserva integer NOT NULL,
      id_sede integer NOT NULL,
      id_empresa integer NOT NULL
    );
    CREATE TABLE pagos (
      id uuid PRIMARY KEY,
      id_reserva integer,
      id_orden_externa varchar(100),
      mp_preference_id varchar(100),
      mp_payment_id varchar(100),
      mp_payment_status varchar(50),
      mp_payment_type varchar(50),
      monto numeric(12,2) NOT NULL,
      moneda varchar(3),
      descripcion text,
      fecha_creacion timestamptz,
      fecha_actualizacion timestamptz,
      fecha_aprobacion timestamptz,
      metadata jsonb,
      id_empresa integer
    );

    INSERT INTO sedes VALUES (101, 10), (102, 10), (201, 20);
    INSERT INTO usuarios VALUES (2, 10), (7, 10), (9, 10), (10, 20);
    INSERT INTO trato_empresa_garage VALUES (1001, 101), (1002, 101), (1003, 102), (2001, 201), (2002, 201);
    INSERT INTO reservas VALUES
      (100, 2, 1001), (101, 7, 1002), (102, 9, 1003),
      (200, 10, 2001), (201, 10, 2001), (2147483647, 10, 2002);
    INSERT INTO consumos_reserva VALUES
      (1000, 100, 101, 10),
      (1001, 101, 101, 10),
      (1002, 102, 102, 10),
      (2000, 200, 201, 20),
      (9223372036854775807, 201, 201, 20);
  `);

  await insertPayment({ number: 1, reservationId: 100, reference: 'A-HISTORY', mp: 100, amount: 100, company: 10, metadata: { id_reserva: 100 } });
  await insertPayment({ number: 2, reservationId: 101, reference: 'A-OTHER', preference: 'pref-101', mp: 101, amount: 110, company: 10, metadata: { id_reserva: 101 } });
  await insertPayment({ number: 3, reservationId: 102, reference: 'A-SITE-2', preference: 'pref-102', mp: 102, amount: 120, company: 10, metadata: { id_reserva: 102 } });
  await insertPayment({ number: 4, reference: 'A-GROUP', preference: 'pref-300', mp: 300, amount: 300, company: 10, metadata: { consumos_ids: [1000] } });
  await insertPayment({ number: 5, reservationId: 200, reference: 'B-PAY', preference: 'pref-200', mp: 200, amount: 200, company: 20, metadata: { id_reserva: 200 } });
  await insertPayment({ number: 6, reference: 'B-MAX-BIGINT', preference: 'pref-400', mp: 400, amount: 400, company: 20, metadata: { consumos_ids: ['9223372036854775807'] } });
  await insertPayment({ number: 7, reservationId: 2147483647, reference: 'B-MAX-INT', preference: 'pref-406', mp: 406, amount: 406, company: 20, metadata: { id_reserva: '2147483647' } });

  await insertPayment({ number: 20, reference: 'B-OVER-BIGINT', preference: 'pref-401', mp: 401, amount: 401, company: 20, metadata: { consumos_ids: ['9223372036854775808'] } });
  await insertPayment({ number: 21, reference: 'B-TEXT-ID', preference: 'pref-402', mp: 402, amount: 402, company: 20, metadata: { consumos_ids: ['not-an-id'] } });
  await insertPayment({ number: 22, reference: 'B-MISSING-ID', preference: 'pref-403', mp: 403, amount: 403, company: 20, metadata: { consumos_ids: ['999999'] } });
  await insertPayment({ number: 23, reservationId: 200, reference: 'B-OVER-INT', preference: 'pref-404', mp: 404, amount: 404, company: 20, metadata: { id_reserva: '2147483648' } });
  await insertPayment({ number: 24, reservationId: 200, reference: 'B-TEXT-RESERVATION', preference: 'pref-405', mp: 405, amount: 405, company: 20, metadata: { id_reserva: 'abc' } });
});

test.after(async () => {
  await db.close();
});

test('SQL real aisla empresa, sede y empleados aunque otro tenant tenga metadata fuera de rango', async () => {
  const admin = await listAuthorizedPayments(USERS.adminA, {});
  assert.deepEqual(admin.results.map((row) => row.id).sort(), ['100', '101', '102', '300']);
  assert.equal(admin.paging.total, 4);
  assert.equal(admin.totals.amount, 630);

  const siteAdmin = await listAuthorizedPayments(USERS.adminSiteA, {});
  assert.deepEqual(siteAdmin.results.map((row) => row.id).sort(), ['100', '101', '300']);
  assert.equal(siteAdmin.paging.total, 3);
  assert.equal(siteAdmin.totals.amount, 510);

  const employee = await listAuthorizedPayments(USERS.employeeA, {});
  assert.deepEqual(employee.results.map((row) => row.id), ['100']);
  assert.equal(employee.paging.total, 1);
  assert.equal(employee.totals.amount, 100);
});

test('SQL real acepta limites de integer/bigint y excluye exceso, texto y referencias inexistentes', async () => {
  const result = await listAuthorizedPayments(USERS.superadmin, { limit: 100 });
  const ids = result.results.map((row) => row.id).sort();

  assert.deepEqual(ids, ['100', '101', '102', '200', '300', '400', '406']);
  assert.equal(result.paging.total, 7);
  assert.equal(result.totals.amount, 1636);
  assert.equal(ids.some((id) => ['401', '402', '403', '404', '405'].includes(id)), false);
});

test('SQL real sincroniza pago historico propio con NULL y oculta el equivalente ajeno', async () => {
  providerCalls.length = 0;
  writes.length = 0;

  const own = await getAuthorizedPayment(USERS.employeeA, '100');
  assert.equal(own.payment.id, '100');
  assert.deepEqual(providerCalls, [['getPayment', '100']]);
  assert.equal(writes.length, 1);

  providerCalls.length = 0;
  writes.length = 0;
  await assert.rejects(
    getAuthorizedPayment(USERS.employeeSameSite, '100'),
    (error) => error.statusCode === 404 && error.code === 'payment_not_found'
  );
  assert.deepEqual(providerCalls, []);
  assert.deepEqual(writes, []);
});

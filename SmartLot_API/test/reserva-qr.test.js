import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const poolState = { client: null };

mock.module('../src/database/db.js', {
  defaultExport: {
    query: async () => ({ rowCount: 0, rows: [] }),
    connect: async () => poolState.client,
  },
});

const [{ default: ReservaService }, { requireRole }] = await Promise.all([
  import('../src/services/reservaService.js'),
  import('../src/middlewares/rolesMiddleware.js'),
]);

const QR_TOKEN = '0bb648bc-c646-443b-93d3-93f095db861a';
const QR = `smartlot:${QR_TOKEN}`;

const futureDate = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

function qrServiceFixture(overrides = {}) {
  const svc = new ReservaService();
  const reserva = {
    id: 15,
    id_usuario: 20,
    fecha_salida: futureDate(),
    entro: false,
    salio: false,
    Borrado: false,
    estado_reserva: 'confirmada',
    qr_token: QR_TOKEN,
    ...overrides,
  };

  svc.repo = {
    expirePendingAsync: async () => 0,
    getQrByIdAsync: async () => reserva,
  };

  return { svc, reserva };
}

function checkInFixture() {
  const svc = new ReservaService();
  const state = { entered: false, reservationUpdates: 0, garageUpdates: 0, commands: [] };
  const reservation = {
    id: 15,
    id_garage: 8,
    estado_reserva: 'confirmada',
    patente: 'AA123BB',
    entro: false,
    salio: false,
    fecha_entrada: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    fecha_salida: futureDate(),
  };
  const client = {
    query: async (sql) => {
      state.commands.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: () => state.commands.push('RELEASE'),
  };
  poolState.client = client;

  svc.repo = {
    getByQrTokenAsync: async (token) => token === QR_TOKEN
      ? { id: reservation.id, patente: reservation.patente }
      : null,
    getByIdForUpdateWithClientAsync: async () => ({
      ...reservation,
      entro: state.entered,
    }),
    registrarIngresoWithClientAsync: async () => {
      if (state.entered) return null;
      state.entered = true;
      state.reservationUpdates += 1;
      return { ...reservation, entro: true };
    },
  };
  svc.garageService = {
    getByIdAsync: async (id, user) => (
      Number(id) === 8 && (Number(user?.id_rol) !== 3 || Number(user?.id_garage) === 8)
        ? { id: 8 }
        : null
    ),
    getByIdForUpdateWithClientAsync: async () => ({
      id: 8,
      estado: true,
      capacidad: 10,
      capacidad_reservas: 10,
      ocupacion_reservas: state.garageUpdates,
      ocupacion_no_reservas: 0,
    }),
    incrementOcupacionReservasWithClientAsync: async () => {
      state.garageUpdates += 1;
      return { id: 8, ocupacion_reservas: state.garageUpdates };
    },
  };

  return { svc, state };
}

test('el titular de una reserva confirmada obtiene una respuesta QR minima', async () => {
  const { svc } = qrServiceFixture();
  assert.deepEqual(await svc.getQrAsync(15, { id: 20, id_rol: 2 }), {
    id_reserva: 15,
    qr: QR,
  });
});

test('un empleado no puede obtener el QR de una reserva ajena', async () => {
  const { svc } = qrServiceFixture();
  await assert.rejects(svc.getQrAsync(15, { id: 21, id_rol: 2 }), { statusCode: 403 });
});

test('una reserva inexistente devuelve 404 al solicitar su QR', async () => {
  const { svc } = qrServiceFixture();
  svc.repo.getQrByIdAsync = async () => null;
  await assert.rejects(svc.getQrAsync(999, { id: 20, id_rol: 2 }), { statusCode: 404 });
});

test('reservas pendientes, canceladas o expiradas no entregan QR', async () => {
  for (const fields of [
    { estado_reserva: 'pendiente_pago' },
    { Borrado: true },
    { estado_reserva: 'expirada' },
    { fecha_salida: new Date(Date.now() - 1000).toISOString() },
  ]) {
    const { svc } = qrServiceFixture(fields);
    await assert.rejects(svc.getQrAsync(15, { id: 20, id_rol: 2 }), { statusCode: 409 });
  }
});

test('una reserva que ya ingreso no entrega QR', async () => {
  const { svc } = qrServiceFixture({ entro: true });
  await assert.rejects(svc.getQrAsync(15, { id: 20, id_rol: 2 }), { statusCode: 409 });
});

test('un QR mal formado devuelve 400 antes de consultar la reserva', async () => {
  const { svc } = checkInFixture();
  for (const qr of [undefined, '', QR_TOKEN, `otro:${QR_TOKEN}`, 'smartlot:no-es-uuid', `${QR}:extra`]) {
    await assert.rejects(svc.checkInByQrAsync(qr, { id: 30, id_rol: 3, id_garage: 8 }), { statusCode: 400 });
  }
});

test('un QR con formato valido pero inexistente devuelve 404', async () => {
  const { svc } = checkInFixture();
  const missing = 'smartlot:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await assert.rejects(svc.checkInByQrAsync(missing, { id: 30, id_rol: 3, id_garage: 8 }), { statusCode: 404 });
});

test('un garagista autorizado registra el ingreso reutilizando el check-in transaccional', async () => {
  const { svc, state } = checkInFixture();
  const result = await svc.checkInByQrAsync(QR, { id: 30, id_rol: 3, id_garage: 8 });
  assert.equal(result.entro, true);
  assert.equal(state.reservationUpdates, 1);
  assert.equal(state.garageUpdates, 1);
  assert.ok(state.commands.includes('BEGIN'));
  assert.ok(state.commands.includes('COMMIT'));
});

test('un garagista no puede usar un QR de otro garage', async () => {
  const { svc, state } = checkInFixture();
  await assert.rejects(svc.checkInByQrAsync(QR, { id: 31, id_rol: 3, id_garage: 99 }), { statusCode: 403 });
  assert.equal(state.reservationUpdates, 0);
  assert.equal(state.garageUpdates, 0);
  assert.ok(state.commands.includes('ROLLBACK'));
});

test('escanear dos veces el mismo QR no duplica ingreso ni ocupacion', async () => {
  const { svc, state } = checkInFixture();
  const user = { id: 30, id_rol: 3, id_garage: 8 };
  await svc.checkInByQrAsync(QR, user);
  await assert.rejects(svc.checkInByQrAsync(QR, user), { statusCode: 400 });
  assert.equal(state.reservationUpdates, 1);
  assert.equal(state.garageUpdates, 1);
});

test('el check-in original por patente continua funcionando', async () => {
  const { svc, state } = checkInFixture();
  const result = await svc.checkInAsync(15, 'AA 123-BB', { id: 1, id_rol: 1 });
  assert.equal(result.entro, true);
  assert.equal(state.reservationUpdates, 1);
  assert.equal(state.garageUpdates, 1);
});

test('un rol no permitido no puede usar el endpoint de escaneo', () => {
  const middleware = requireRole(1, 3, 4);
  let nextCalled = false;
  let responseStatus;
  const res = {
    status(code) { responseStatus = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };

  middleware({ usuario: { id: 20, id_rol: 2 } }, res, () => { nextCalled = true; });
  assert.equal(responseStatus, 403);
  assert.equal(nextCalled, false);
});

test('las rutas QR estan ordenadas y el token no se expone en respuestas generales', async () => {
  const [controller, repository] = await Promise.all([
    readFile(new URL('../src/controllers/reservaController.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/repositories/reservaRepository.js', import.meta.url), 'utf8'),
  ]);

  assert.ok(controller.indexOf("router.post('/qr/check-in'") < controller.indexOf("router.post('/:id/check-in'"));
  assert.match(controller, /router\.get\('\/:id\/qr', requireRole\(2\)/);
  assert.match(repository, /const \{ qr_token, \.\.\.safeRow \} = row/);
  assert.match(repository, /WHERE r\.qr_token = \$1::uuid/);
});

test('la migracion genera y completa UUID unicos antes de exigir NOT NULL', async () => {
  const migration = await readFile(
    new URL('../migrations/20260918_003_reservas_qr_token.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS qr_token uuid/i);
  assert.match(migration, /SET qr_token = gen_random_uuid\(\)[\s\S]*WHERE qr_token IS NULL/i);
  assert.match(migration, /ALTER COLUMN qr_token SET DEFAULT gen_random_uuid\(\)/i);
  assert.match(migration, /ALTER COLUMN qr_token SET NOT NULL/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_reservas_qr_token/i);
});

test.after(() => mock.restoreAll());

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// Postgres real en memoria: el fallo era de placeholders ($n) y solo el motor SQL lo detecta.
const db = new PGlite();
mock.module('../src/database/db.js', {
  exports: { default: { query: (sql, params) => db.query(sql, params) } },
});
const { default: ConflictoRepository } = await import('../src/repositories/ConflictoRepository.js');
const repo = new ConflictoRepository();

const adminSede101 = { id: 2, id_rol: 1, id_sede: 101 };
const adminEmpresa10 = { id: 3, id_rol: 1, id_empresa: 10 };
const superadmin = { id: 4, id_rol: 4 };
const cambios = { id_usuario: 7, descripcion: 'Resuelto', prioridad: 'Alta', estado: 'Resuelto', SuperAdmin: true };

const estadoDe = async (id) => (await db.query('SELECT estado FROM conflictos WHERE id = $1', [id])).rows[0].estado;

test.before(async () => {
  await db.exec(`
    CREATE TABLE usuarios (id int PRIMARY KEY, id_sede int, id_empresa int);
    CREATE TABLE conflictos (
      id serial PRIMARY KEY,
      id_usuario int REFERENCES usuarios(id),
      descripcion text,
      prioridad text,
      estado text,
      "SuperAdmin" boolean DEFAULT false,
      "Borrado" boolean DEFAULT false,
      "DeleteBy" int,
      "DeleteAt" timestamptz
    );
    INSERT INTO usuarios VALUES (7, 101, 10), (8, 102, 10);
  `);
});

test.beforeEach(async () => {
  await db.exec(`
    DELETE FROM conflictos;
    INSERT INTO conflictos (id, id_usuario, descripcion, prioridad, estado, "SuperAdmin") VALUES
      (1, 7, 'Ruido en sede A1', 'Baja', 'Pendiente', false),
      (2, 8, 'Ruido en sede A2', 'Baja', 'Pendiente', false);
  `);
});

test.after(() => db.close());

test('actualiza con columna SuperAdmin dentro de la sede del solicitante', async () => {
  const updated = await repo.updateAsync(1, cambios, adminSede101);

  assert.equal(updated?.estado, 'Resuelto');
  assert.equal(updated?.prioridad, 'Alta');
  assert.equal(updated?.SuperAdmin, true);
});

test('no actualiza conflictos de otra sede (devuelve null sin error)', async () => {
  const updated = await repo.updateAsync(2, cambios, adminSede101);

  assert.equal(updated, null);
  assert.equal(await estadoDe(2), 'Pendiente');
});

test('actualiza con columna SuperAdmin dentro de la empresa del solicitante', async () => {
  const updated = await repo.updateAsync(2, cambios, adminEmpresa10);

  assert.equal(updated?.estado, 'Resuelto');
});

test('superadmin actualiza cualquier conflicto sin filtro de tenant', async () => {
  const updated = await repo.updateAsync(2, cambios, superadmin);

  assert.equal(updated?.estado, 'Resuelto');
});

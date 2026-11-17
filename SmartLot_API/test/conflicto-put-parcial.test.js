import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// "Manden un solo campo en un PUT: ¿qué quedó guardado en las demás columnas?" (devolución, punto 4).
const db = new PGlite();
mock.module('../src/database/db.js', {
  defaultExport: { query: (sql, params) => db.query(sql, params), connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) },
});
mock.module('../src/services/emailService.js', {
  namedExports: { enviarCorreoDesdePlantilla: async () => {}, enviarCorreo: async () => {} },
});
const { default: ConflictoService } = await import('../src/services/ConflictoService.js');

const superadmin = { id: 4, id_rol: 4 };
const svc = new ConflictoService();
svc.usuarioService = { getByIdAsync: async (id) => ({ id }) };

test.before(async () => {
  await db.exec(`
    CREATE TABLE usuarios (id int PRIMARY KEY, id_sede int, id_empresa int);
    CREATE TABLE conflictos (
      id serial PRIMARY KEY, id_usuario int REFERENCES usuarios(id), descripcion text, prioridad text, estado text,
      "SuperAdmin" boolean DEFAULT false, "Borrado" boolean DEFAULT false, "DeleteBy" int, "DeleteAt" timestamptz
    );
    INSERT INTO usuarios VALUES (7, 101, 10);
    INSERT INTO conflictos (id, id_usuario, descripcion, prioridad, estado, "SuperAdmin")
      VALUES (1, 7, 'Ruido en sede A1', 'Baja', 'Pendiente', true);
  `);
});
test.after(() => db.close());

test('PUT de conflicto con un solo campo conserva las demás columnas', async () => {
  const updated = await svc.updateAsync(1, { estado: 'Resuelto' }, superadmin);

  assert.equal(updated.estado, 'Resuelto');
  assert.equal(updated.id_usuario, 7);
  assert.equal(updated.descripcion, 'Ruido en sede A1');
  assert.equal(updated.prioridad, 'Baja');
  assert.equal(updated.SuperAdmin, true);
});

test('PUT de conflicto inexistente devuelve null (el controller responde 404)', async () => {
  assert.equal(await svc.updateAsync(999, { estado: 'Resuelto' }, superadmin), null);
});

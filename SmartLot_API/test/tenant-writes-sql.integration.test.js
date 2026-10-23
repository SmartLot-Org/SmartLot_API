import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// PostgreSQL aislado; controllers, middleware, servicios y SQL reales.
const db = new PGlite();
let tail = Promise.resolve();
let emails = 0;
const pool = {
  query: (sql, params) => db.query(sql, params),
  connect: async () => {
    const previous = tail;
    const done = Promise.withResolvers();
    tail = done.promise;
    await previous;
    return { query: (sql, params) => db.query(sql, params), release: done.resolve };
  }
};
mock.module('../src/database/db.js', { defaultExport: pool });
mock.module('../src/services/emailService.js', { namedExports: {
  enviarCorreoDesdePlantilla: async () => { emails++; }
} });
process.env.JWT_SECRET = 'seg04-isolated-test-secret';
const { default: auth } = await import('../src/middlewares/authMiddleware.js');
const { default: sedes } = await import('../src/controllers/sedeController.js');
const { default: usuarios } = await import('../src/controllers/usuarioController.js');
const { default: reservas } = await import('../src/controllers/reservaController.js');
const app = express();
app.use(express.json());
app.use('/sedes', auth, sedes);
app.use('/usuarios', usuarios);
app.use('/reservas', auth, reservas);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
const token = (id, claims = {}) => `Bearer ${jwt.sign({ ...claims, id }, process.env.JWT_SECRET)}`;
const call = (method, url, actor = 1, body = {}, claims = {}) => {
  const req = request(app)[method](url);
  if (actor) req.set('Authorization', token(actor, claims));
  return req.send(body);
};
const snapshot = async () => {
  const result = {};
  for (const table of ['sedes', 'usuarios', 'reservas', 'refresh_sessions', 'garages']) {
    result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return result;
};
const reserve = async (user = 7, patch = {}) => {
  const row = { id_usuario: user, id_trato: user === 9 ? 3 : user === 8 ? 2 : 1,
    estado_reserva: 'pendiente_pago', fecha_entrada: '2099-01-10T10:00:00',
    entro: false, salio: false, ...patch };
  return (await db.query(`INSERT INTO reservas(id_usuario,id_trato,id_garage,estado_reserva,fecha_entrada,fecha_salida,
    entro,salio,retencion_pago_hasta,responsable_pago,tarifa_hora_aplicada,importe_estimado)
    VALUES($1,$2,1,$3,$4,'2099-01-10 11:00:00',$5,$6,'2099-01-10','empleado',120.15,120.15) RETURNING id`,
  [row.id_usuario, row.id_trato, row.estado_reserva, row.fecha_entrada, row.entro, row.salio])).rows[0].id;
};

test.before(async () => {
  await db.exec(`
    CREATE TABLE roles(id int PRIMARY KEY,tipo_rol text,"Borrado" boolean DEFAULT false);
    CREATE TABLE empresas(id int PRIMARY KEY,nombre text,"Borrado" boolean DEFAULT false);
    CREATE TABLE sedes(id serial PRIMARY KEY,id_empresa int REFERENCES empresas(id),nombre text,descripcion text,
      ubicacion text,latitud numeric,longitud numeric,"Borrado" boolean DEFAULT false);
    CREATE TABLE usuarios(id int PRIMARY KEY,id_rol int,id_empresa int,id_sede int,nombre text,apellido text,
      email text,telefono text,contraseña text,activo boolean DEFAULT true,token_version int DEFAULT 7,"Borrado" boolean DEFAULT false,
      "UpdateBy" int,"UpdateAt" timestamptz,"DeleteBy" int,"DeleteAt" timestamptz);
    CREATE TABLE usuario_garage(id_usuario int,id_garage int);
    CREATE TABLE refresh_sessions(id int PRIMARY KEY,usuario_id int,token_version int,refresh_token text,expires_at timestamptz);
    CREATE TABLE garages(id int PRIMARY KEY,ocupacion_reservas int,capacidad int);
    CREATE TABLE trato_empresa_garage(id int PRIMARY KEY,id_sede int,id_garage int,"Borrado" boolean DEFAULT false);
    CREATE TABLE reservas(id serial PRIMARY KEY,id_usuario int REFERENCES usuarios(id),id_trato int,id_garage int,
      estado_reserva text,fecha_entrada timestamp,fecha_salida timestamp,entro boolean,salio boolean,
      retencion_pago_hasta timestamptz,responsable_pago text,tarifa_hora_aplicada numeric,importe_estimado numeric,
      "Borrado" boolean DEFAULT false);
    INSERT INTO roles VALUES(1,'admin'),(2,'cliente'),(3,'garagista'),(4,'superadmin'),(5,'dueño_garage');
    INSERT INTO empresas VALUES(10,'A'),(20,'B');
  `);
});
test.beforeEach(async () => {
  emails = 0;
  await db.exec(`TRUNCATE reservas,refresh_sessions,usuarios,sedes,garages,trato_empresa_garage RESTART IDENTITY CASCADE;
    INSERT INTO sedes(id,id_empresa,nombre,descripcion,ubicacion,latitud,longitud) VALUES
      (101,10,'A1','Desc','Calle',-34,-58),(102,10,'A2','Otra','Otra calle',-35,-59),(201,20,'B1','B','B',-36,-60);
    SELECT setval('sedes_id_seq',1000);
    INSERT INTO usuarios(id,id_rol,id_empresa,id_sede,nombre,apellido,email) VALUES
      (1,1,10,NULL,'Admin','A','a@test.test'),(2,1,10,101,'Admin','Sede','s@test.test'),
      (3,1,20,NULL,'Admin','B','b@test.test'),(4,4,NULL,NULL,'Super','Admin','super@test.test'),
      (5,3,NULL,NULL,'Garage','User','g@test.test'),(6,5,NULL,NULL,'Owner','User','o@test.test'),
      (7,2,10,101,'Empleado','A1','e1@test.test'),(8,2,10,102,'Empleado','A2','e2@test.test'),
      (9,2,20,201,'Empleado','B','eb@test.test'),(10,2,10,101,'Empleado','Otro','eo@test.test');
    INSERT INTO refresh_sessions VALUES(7,7,7,'seven','2099-01-01'),(9,9,7,'nine','2099-01-01');
    INSERT INTO garages VALUES(1,2,20);
    INSERT INTO trato_empresa_garage VALUES(1,101,1),(2,102,1),(3,201,1);
  `);
});
test.after(() => db.close());

test('reproduccion SEG-04: admin A no crea sede en B', async () => {
  const before = await snapshot();
  const res = await call('post', '/sedes', 1, { nombre: 'Intrusa', id_empresa: 20 });
  assert.equal(res.status, 403, res.text);
  assert.deepEqual(await snapshot(), before);
});
test('reproduccion SEG-04: admin A no desactiva usuario B ni revoca tokens', async () => {
  const before = await snapshot();
  const res = await call('patch', '/usuarios/9/estado', 1, { activo: false });
  assert.equal(res.status, 404, res.text);
  assert.deepEqual(await snapshot(), before);
});
test('reproduccion SEG-04: admin A no cancela reserva B', async () => {
  const id = await reserve(9);
  const before = await snapshot();
  const res = await call('post', `/reservas/${id}/cancel`);
  assert.equal(res.status, 404, res.text);
  assert.deepEqual(await snapshot(), before);
});

for (const body of [{ nombre: 'Nueva' }, { nombre: 'Nueva', id_empresa: 10 }]) {
  test(`sede: creacion usa empresa autenticada (${JSON.stringify(body)})`, async () => {
    const res = await call('post', '/sedes', 1, body);
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.id_empresa, 10);
  });
}
test('sede: admin limitado no crea otra sede', async () => {
  assert.equal((await call('post', '/sedes', 2, { nombre: 'Nueva', id_empresa: 10 })).status, 403);
});
for (const [method, path, body] of [
  ['put', '/sedes/201', { nombre: 'Intrusa' }], ['delete', '/sedes/201', {}],
  ['put', '/sedes/201', { id_empresa: 10 }],
]) test(`sede: escritura ajena ${method} ${JSON.stringify(body)}`, async () => {
  const before = await snapshot();
  assert.equal((await call(method, path, 1, body)).status, 404);
  assert.deepEqual(await snapshot(), before);
});
for (const method of ['put', 'delete']) test(`sede: admin sede no ${method} otra de la misma empresa`, async () => {
  const before = await snapshot();
  assert.equal((await call(method, '/sedes/102', 2, { nombre: 'Intrusa' })).status, 404);
  assert.deepEqual(await snapshot(), before);
});
test('sede: editar nombre preserva campos y rechaza transferencia', async () => {
  const before = (await db.query('SELECT * FROM sedes WHERE id=101')).rows[0];
  const res = await call('put', '/sedes/101', 2, { nombre: 'Nuevo nombre' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { ...before, nombre: 'Nuevo nombre' });
  assert.equal((await call('put', '/sedes/101', 1, { id_empresa: 20 })).status, 403);
});
test('sede: superadmin valida destino, crea, transfiere y elimina globalmente', async () => {
  assert.equal((await call('post', '/sedes', 4, { nombre: 'Nueva' })).status, 400);
  assert.equal((await call('post', '/sedes', 4, { nombre: 'Nueva', id_empresa: 999 })).status, 400);
  assert.equal((await call('post', '/sedes', 4, { nombre: 'Nueva', id_empresa: 20 })).status, 201);
  assert.equal((await call('put', '/sedes/201', 4, { id_empresa: 10 })).status, 200);
  assert.equal((await call('delete', '/sedes/201', 4)).status, 200);
});

for (const [actor, target] of [[1, 9], [2, 8]]) {
  for (const active of [false, true, 'delete']) test(`usuario: ${actor} no cambia ${active} a ${target} fuera de alcance`, async () => {
    if (active === true) await db.query('UPDATE usuarios SET activo=false WHERE id=$1', [target]);
    const before = await snapshot();
    const res = active === 'delete' ? await call('delete', `/usuarios/${target}`, actor) :
      await call('patch', `/usuarios/${target}/estado`, actor, { activo: active, id_empresa: 10, id_sede: 101, id_rol: 2 });
    assert.equal(res.status, 404, res.text);
    assert.deepEqual(await snapshot(), before);
    assert.equal(emails, 0);
  });
}
for (const op of ['estado', 'delete']) test(`usuario: admin no modifica superadmin con empresa manipulada (${op})`, async () => {
  await db.query('UPDATE usuarios SET id_empresa=10,id_sede=101 WHERE id=4');
  const before = await snapshot();
  const res = op === 'delete' ? await call('delete', '/usuarios/4') : await call('patch', '/usuarios/4/estado', 1, { activo: false });
  assert.equal(res.status, 403, res.text);
  assert.deepEqual(await snapshot(), before);
});
for (const actor of [1, 2, 4]) test(`usuario: actor ${actor} cambia estado y elimina dentro de alcance`, async () => {
  let res = await call('patch', '/usuarios/7/estado', actor, { activo: false });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.token_version, 8);
  assert.equal(res.body.UpdateBy, actor);
  assert.equal((await db.query('SELECT * FROM refresh_sessions WHERE usuario_id=7')).rows.length, 0);
  res = await call('patch', '/usuarios/7/estado', actor, { activo: true });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.token_version, 9);
  assert.equal((await call('delete', '/usuarios/7', actor)).status, 200);
  const row = (await db.query('SELECT * FROM usuarios WHERE id=7')).rows[0];
  assert.equal(row.Borrado, true);
  assert.equal(row.DeleteBy, actor);
  assert.equal(row.token_version, 10);
});
for (const op of ['estado', 'delete']) test(`usuario: restricciones reservas y ausencia de efectos (${op})`, async () => {
  await reserve(7);
  const before = await snapshot();
  const res = op === 'delete' ? await call('delete', '/usuarios/7') : await call('patch', '/usuarios/7/estado', 1, { activo: false });
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(await snapshot(), before);
});
test('usuario: reserva finalizada permite desactivar pero impide borrar', async () => {
  await reserve(7, { salio: true });
  assert.equal((await call('patch', '/usuarios/7/estado', 1, { activo: false })).status, 200);
  assert.equal((await call('delete', '/usuarios/7')).status, 400);
});
test('usuario: superadmin opera globalmente sobre B', async () => {
  assert.equal((await call('patch', '/usuarios/9/estado', 4, { activo: false })).status, 200);
  assert.equal((await call('delete', '/usuarios/9', 4)).status, 200);
});

for (const [method, suffix] of [['post', '/cancel'], ['post', '/liberar-retencion'], ['delete', '']]) {
  for (const [actor, owner] of [[1, 9], [2, 8], [7, 10]]) test(`reserva: ${actor} no ${method}${suffix} de ${owner}`, async () => {
    const id = await reserve(owner);
    const before = await snapshot();
    const res = await call(method, `/reservas/${id}${suffix}`, actor, { id_usuario: actor, id_empresa: 10, id_sede: 101, id_rol: 4 });
    assert.equal(res.status, method === 'delete' && actor === 7 ? 403 : 404, res.text);
    assert.deepEqual(await snapshot(), before);
  });
  for (const [actor, owner] of [[1, 7], [2, 7], [7, 7], [4, 9]]) {
    if (method === 'delete' && actor === 7) continue;
    test(`reserva: ${actor} puede ${method}${suffix} de ${owner}`, async () => {
      const id = await reserve(owner);
      const before = await snapshot();
      const res = await call(method, `/reservas/${id}${suffix}`, actor);
      assert.equal(res.status, 200, res.text);
      const after = await snapshot();
      assert.deepEqual(after, { ...before, reservas: before.reservas.map(r => ({ ...r, Borrado: true,
        retencion_pago_hasta: suffix === '/liberar-retencion' ? null : r.retencion_pago_hasta })) });
    });
  }
}
for (const [suffix, patch, code] of [
  ['/cancel', { entro: true }, 400], ['/cancel', { fecha_entrada: '2000-01-01' }, 400],
  ['/liberar-retencion', { entro: true }, 400],
  ['/liberar-retencion', { estado_reserva: 'confirmada' }, 409],
]) test(`reserva: conserva validacion de negocio ${JSON.stringify(patch)}`, async () => {
  const id = await reserve(7, patch);
  const before = await snapshot();
  const res = await call('post', `/reservas/${id}${suffix}`, 7);
  assert.equal(res.status, code, res.text);
  assert.deepEqual(await snapshot(), before);
});
test('admin general conserva operaciones en otra sede de su empresa', async () => {
  assert.equal((await call('put', '/sedes/102', 1, { nombre: 'Permitida' })).status, 200);
  assert.equal((await call('patch', '/usuarios/8/estado', 1, { activo: false })).status, 200);
  assert.equal((await call('patch', '/usuarios/8/estado', 1, { activo: true })).status, 200);
  const id = await reserve(8);
  assert.equal((await call('post', `/reservas/${id}/cancel`, 1)).status, 200);
});
test('empleado no cambia su estado, se borra ni usa DELETE de su reserva', async () => {
  const id = await reserve(7);
  const before = await snapshot();
  assert.equal((await call('patch', '/usuarios/7/estado', 7, { activo: false })).status, 403);
  assert.equal((await call('delete', '/usuarios/7', 7)).status, 403);
  assert.equal((await call('delete', `/reservas/${id}`, 7)).status, 403);
  assert.deepEqual(await snapshot(), before);
});
test('sede: payload de identidad y auditoria no cambia el contexto autorizado', async () => {
  const res = await call('post', '/sedes', 1, { nombre: 'Permitida', id_sede: 201,
    id_usuario: 4, id_rol: 4, Borrado: true, UpdateBy: 4 });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.id_empresa, 10);
  assert.equal(res.body.Borrado, false);
});

for (const [method, path, body] of [
  ['post', '/sedes', { nombre: 'Nueva', id_empresa: 10 }], ['put', '/sedes/101', { nombre: 'Nueva' }],
  ['delete', '/sedes/101', {}], ['patch', '/usuarios/7/estado', { activo: false }], ['delete', '/usuarios/7', {}],
  ['post', '/reservas/1/cancel', {}], ['post', '/reservas/1/liberar-retencion', {}], ['delete', '/reservas/1', {}]
]) test(`HTTP: sin sesion y rol no autorizado ${method} ${path}`, async () => {
  const before = await snapshot();
  assert.equal((await call(method, path, null, body)).status, 401);
  assert.equal((await call(method, path, 5, body)).status, 403);
  assert.deepEqual(await snapshot(), before);
});
test('HTTP: claims y body falsificados no reemplazan contexto validado por middleware', async () => {
  const id = await reserve(9);
  const before = await snapshot();
  const res = await call('post', `/reservas/${id}/cancel`, 1, { id_rol: 4 }, { id_rol: 4, id_empresa: 20, id_sede: 201 });
  assert.equal(res.status, 404, res.text);
  assert.deepEqual(await snapshot(), before);
});

for (const deleting of [false, true]) test(`usuario: fallo al revocar sesiones revierte estado, token y auditoria (delete=${deleting})`, async () => {
  // Falla DESPUES de la escritura del usuario, mediante SQL real del motor.
  await db.exec(`CREATE FUNCTION fail_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'seg04_session_failure'; END $$;
    CREATE TRIGGER fail_sessions BEFORE DELETE ON refresh_sessions
    FOR EACH ROW EXECUTE FUNCTION fail_session_delete();`);
  const before = await snapshot();
  try {
    const res = deleting ? await call('delete', '/usuarios/7') : await call('patch', '/usuarios/7/estado', 1, { activo: false });
    assert.equal(res.status, 500, res.text);
    assert.match(res.body.message, /seg04_session_failure/);
    assert.deepEqual(await snapshot(), before);
    assert.equal(emails, 0);
  } finally {
    await db.exec('DROP TRIGGER fail_sessions ON refresh_sessions; DROP FUNCTION fail_session_delete();');
  }
});
for (const table of ['sedes', 'reservas']) test(`${table}: error SQL de escritura se propaga y revierte efectos`, async () => {
  const id = table === 'reservas' ? await reserve(7) : 101;
  await db.exec(`CREATE FUNCTION fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'seg04_write_failure'; END $$;
    CREATE TRIGGER fail_write AFTER UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_write();`);
  const before = await snapshot();
  try {
    const res = table === 'sedes' ? await call('put', `/sedes/${id}`, 1, { nombre: 'Cambio' }) :
      await call('post', `/reservas/${id}/liberar-retencion`, 7);
    assert.equal(res.status, 500, res.text);
    assert.match(res.body.message, /seg04_write_failure/);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.exec(`DROP TRIGGER fail_write ON ${table}; DROP FUNCTION fail_write();`);
  }
});
test('servicios: actor ausente no habilita escrituras internas globales', async () => {
  const { default: Sedes } = await import('../src/services/sedeService.js');
  const { default: Usuarios } = await import('../src/services/usuarioService.js');
  const { default: Reservas } = await import('../src/services/reservaService.js');
  const s = new Sedes(), u = new Usuarios(), r = new Reservas();
  await reserve(7);
  const before = await snapshot();
  for (const op of [() => s.createAsync({ nombre: 'Intrusa', id_empresa: 10 }),
    () => s.updateAsync(101, { nombre: 'Intrusa' }), () => s.deleteAsync(101),
    () => u.updateEstadoAsync(7, false), () => u.deleteAsync(7),
    () => r.cancelarAsync(1), () => r.deleteAsync(1), () => r.liberarRetencionAsync(1)]) {
    await assert.rejects(op, { statusCode: 401 });
  }
  assert.deepEqual(await snapshot(), before);
});
test('SQL de repositorios mantiene alcance en la escritura y no permite transferir sede', async () => {
  const { default: Sedes } = await import('../src/repositories/sedeRepository.js');
  const { default: Usuarios } = await import('../src/repositories/usuarioRepository.js');
  const { default: Reservas } = await import('../src/repositories/reservaRepository.js');
  const { authorizeWrite } = await import('../src/helpers/writeAuthorization.js');
  const scope = authorizeWrite({ id: 1, id_rol: 1, id_empresa: 10 });
  const id = await reserve(9);
  const before = await snapshot();
  const s = new Sedes(), u = new Usuarios(), r = new Reservas();
  assert.equal(await s.updateAsync(201, { nombre: 'Intrusa' }, scope), null);
  assert.equal(await s.updateAsync(101, { id_empresa: 20 }, scope), null);
  assert.equal(await s.deleteAsync(201, scope), false);
  assert.equal(await u.updateEstadoAsync(9, false, scope), null);
  assert.equal(await u.deleteAsync(9, scope), false);
  assert.equal(await r.cancelarWithClientAsync(id, pool, scope), null);
  assert.equal(await r.liberarRetencionWithClientAsync(id, pool, scope), false);
  // Tambien las firmas sin contexto antiguas fallan cerradas.
  assert.equal(await s.updateAsync(101, { nombre: 'Intrusa' }), null);
  assert.equal(await u.updateEstadoAsync(7, false), null);
  assert.equal(await r.deleteAsync(id), false);
  assert.deepEqual(await snapshot(), before);
});
test('empresa y sede se exigen juntas incluso ante un contexto persistido incoherente', async () => {
  await db.query('UPDATE usuarios SET id_sede=201 WHERE id=2');
  const id = await reserve(9);
  const before = await snapshot();
  assert.equal((await call('delete', '/sedes/201', 2)).status, 404);
  assert.equal((await call('patch', '/usuarios/9/estado', 2, { activo: false })).status, 404);
  assert.equal((await call('post', `/reservas/${id}/cancel`, 2)).status, 404);
  assert.deepEqual(await snapshot(), before);
});
test('admin sin empresa validada no obtiene alcance global', async () => {
  await db.query('UPDATE usuarios SET id_empresa=NULL WHERE id=1');
  const before = await snapshot();
  assert.equal((await call('delete', '/sedes/101')).status, 403);
  assert.equal((await call('delete', '/usuarios/7')).status, 403);
  assert.equal((await call('post', '/reservas/1/cancel')).status, 403);
  assert.deepEqual(await snapshot(), before);
});
test('usuario: PUT general no permite eludir la operacion de estado', async () => {
  const before = await snapshot();
  const res = await call('put', '/usuarios/7', 1, { activo: false });
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(await snapshot(), before);
});
test('usuario: PUT de perfil acepta estado sin cambios y no altera tokens', async () => {
  const res = await call('put', '/usuarios/7', 1, { nombre: 'Nombre editado', activo: true, token_version: 0 });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.activo, true);
  assert.equal(res.body.token_version, 7);
  assert.equal(res.body.nombre, 'Nombre editado');
  assert.equal((await db.query('SELECT * FROM refresh_sessions WHERE usuario_id=7')).rows.length, 1);
});
test('usuario: edicion de perfil atrasada no restaura estado ni token_version anteriores', async () => {
  const { default: Usuarios } = await import('../src/repositories/usuarioRepository.js');
  const stale = (await db.query('SELECT * FROM usuarios WHERE id=7')).rows[0];
  assert.equal((await call('patch', '/usuarios/7/estado', 1, { activo: false })).status, 200);
  const res = await new Usuarios().updateAsync(7, { ...stale, nombre: 'Nombre editado' }, 1);
  assert.equal(res.activo, false);
  assert.equal(res.token_version, 8);
  assert.equal(res.nombre, 'Nombre editado');
});
for (const [table, method, path, body] of [
  ['sedes', 'put', '/sedes/101', { nombre: 'Cambio' }],
  ['reservas', 'patch', '/usuarios/7/estado', { activo: false }],
  ['reservas', 'post', '/reservas/1/cancel', {}]
]) test(`error SQL en lectura de ${method} ${path} conserva error de servidor`, async () => {
  const before = await snapshot();
  await db.exec(`ALTER TABLE ${table} RENAME TO seg04_unavailable`);
  try {
    const res = await call(method, path, 1, body);
    assert.equal(res.status, 500, res.text);
  } finally {
    await db.exec(`ALTER TABLE seg04_unavailable RENAME TO ${table}`);
  }
  assert.deepEqual(await snapshot(), before);
});

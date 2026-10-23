import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Solo el transporte SQL se sustituye: auth, router, servicios y SQL son reales.
const db = new PGlite();
let tail = Promise.resolve();
let connectionGate;
const pool = {
  query: (sql, params) => db.query(sql, params),
  connect: async () => {
    if (connectionGate) {
      const gate = connectionGate;
      connectionGate = null;
      gate.started.resolve();
      await gate.release.promise;
    }
    const previous = tail;
    const done = Promise.withResolvers();
    tail = done.promise;
    await previous;
    return { query: (sql, params) => db.query(sql, params), release: done.resolve };
  }
};
mock.module('../src/database/db.js', { defaultExport: pool });
mock.module('../src/services/emailService.js', { namedExports: { enviarCorreoDesdePlantilla: async () => {
  throw new Error('Este flujo no debe enviar correo');
} } });
process.env.JWT_SECRET = 'garage-occupancy-isolated-test-secret';
const { default: auth } = await import('../src/middlewares/authMiddleware.js');
const { default: garageRouter } = await import('../src/controllers/garageController.js');
const { default: GarageService } = await import('../src/services/garageService.js');
const app = express();
app.use(express.json());
app.use('/api/garage', auth, garageRouter);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
const call = (direction, garage = 1, actor = 5, body = {}, claims = {}) => {
  const req = request(app).post(`/api/garage/${garage}/${direction}-no-reserva`);
  if (actor) req.set('Authorization', `Bearer ${jwt.sign({ ...claims, id: actor }, process.env.JWT_SECRET)}`);
  return req.send(body);
};
const snapshot = async () => {
  const result = {};
  for (const table of ['garages', 'usuarios', 'sedes', 'usuario_garage', 'trato_empresa_garage']) {
    result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows;
  }
  return result;
};
const garage = async id => (await db.query('SELECT * FROM garages WHERE id=$1', [id])).rows[0];
test.before(async () => {
  await db.exec(`
    CREATE TABLE roles(id int PRIMARY KEY,tipo_rol text,"Borrado" boolean DEFAULT false);
    CREATE TABLE sedes(id int PRIMARY KEY,id_empresa int,"Borrado" boolean DEFAULT false);
    CREATE TABLE usuarios(id int PRIMARY KEY,id_rol int,id_empresa int,id_sede int,activo boolean DEFAULT true,
      "Borrado" boolean DEFAULT false,token_version int DEFAULT 7);
    CREATE TABLE garages(id int PRIMARY KEY,nombre text,id_sede_propia int REFERENCES sedes(id),estado boolean DEFAULT true,
      capacidad int,capacidad_reservas int,capacidad_para_no_reservas int,ocupacion_reservas int DEFAULT 0,
      ocupacion_no_reservas int DEFAULT 0,"Borrado" boolean DEFAULT false,"UpdateAt" timestamptz);
    CREATE TABLE usuario_garage(id_usuario int REFERENCES usuarios(id),id_garage int REFERENCES garages(id),
      PRIMARY KEY(id_usuario,id_garage));
    CREATE TABLE trato_empresa_garage(id int PRIMARY KEY,id_sede int,id_garage int,"Borrado" boolean DEFAULT false);
    CREATE TABLE garage_dias(id_garage int,dia text,activo boolean);
    INSERT INTO roles(id,tipo_rol) VALUES(1,'admin'),(2,'cliente'),(3,'garagista'),(4,'superadmin'),(5,'dueño_garage');
  `);
});
test.beforeEach(async () => {
  connectionGate = null;
  await db.exec(`TRUNCATE sedes,usuarios,garages,usuario_garage,trato_empresa_garage,garage_dias CASCADE;
    INSERT INTO sedes(id,id_empresa) VALUES(101,10),(102,10),(201,20);
    INSERT INTO usuarios(id,id_rol,id_empresa,id_sede) VALUES(1,1,10,NULL),(2,1,10,101),(3,1,20,NULL),
      (4,4,NULL,NULL),(5,3,NULL,NULL),(6,5,NULL,NULL),(7,2,10,101),(8,3,NULL,NULL),(9,1,NULL,NULL);
    INSERT INTO garages(id,nombre,id_sede_propia,capacidad,capacidad_reservas,capacidad_para_no_reservas) VALUES
      (1,'Asignado',NULL,3,1,2),(2,'Ajeno',NULL,3,1,2),(3,'Propio A1',101,3,1,2),
      (4,'Propio A2',102,3,1,2),(5,'Propio B',201,3,1,2),(6,'Borrado',NULL,3,1,2),(7,'Externo con trato',NULL,3,1,2);
    UPDATE garages SET "Borrado"=true WHERE id=6;
    INSERT INTO usuario_garage VALUES(5,1),(5,6),(6,1),(8,1),(8,2);
    INSERT INTO trato_empresa_garage(id,id_sede,id_garage) VALUES(1,101,7),(2,101,3),(3,102,4),(4,201,5);
  `);
});
test.after(() => db.close());

for (const direction of ['ingreso', 'egreso']) test(`reproduccion garage ajeno: ${direction} de garagista no asignado`, async () => {
  if (direction === 'egreso') await db.query('UPDATE garages SET ocupacion_no_reservas=1 WHERE id=2');
  const before = await snapshot();
  const res = await call(direction, 2, 5);
  assert.equal(res.status, 404, res.text);
  assert.deepEqual(await snapshot(), before);
});

for (const [actor, id] of [[5,1],[8,1],[8,2],[1,3],[1,4],[2,3],[3,5],[4,2],[4,5]]) {
  test(`operacion autorizada actor ${actor} garage ${id}: ingreso y egreso`, async () => {
    // Propiedad habilita al admin aun sin un trato comercial.
    if ([1,2,3].includes(actor)) await db.query('DELETE FROM trato_empresa_garage WHERE id_garage=$1', [id]);
    const before = await snapshot();
    const entry = await call('ingreso', id, actor);
    assert.equal(entry.status, 200, entry.text);
    assert.equal(entry.body.ocupacion_no_reservas, 1);
    assert.deepEqual(await garage(id), { ...before.garages.find(g => g.id === id), ocupacion_no_reservas: 1 });
    const exit = await call('egreso', id, actor);
    assert.equal(exit.status, 200, exit.text);
    assert.equal(exit.body.ocupacion_no_reservas, 0);
    assert.deepEqual(await snapshot(), before);
  });
}
for (const direction of ['ingreso','egreso']) {
  for (const [actor,id] of [[1,5],[2,4],[2,5],[3,3],[1,7]]) {
    test(`operacion denegada ${direction}: actor ${actor} garage ${id}`, async () => {
      await db.query('UPDATE garages SET ocupacion_no_reservas=1 WHERE id=$1', [id]);
      const before = await snapshot();
      const res = await call(direction, id, actor);
      assert.equal(res.status, 404, res.text);
      assert.deepEqual(await snapshot(), before);
    });
  }
  for (const actor of [6,7]) test(`${direction}: dueño y empleado no reciben permiso por asociacion ni payload (${actor})`, async () => {
    const before = await snapshot();
    const res = await call(direction, 1, actor, { id_usuario: 5, id_rol: 4, id_empresa: 10, id_garage: 1, id_garages: [1,2] },
      { id_rol: 4, id_empresa: 10, id_garage: 1 });
    assert.equal(res.status, 403, res.text);
    assert.deepEqual(await snapshot(), before);
  });
  test(`${direction}: sin sesion, garage inexistente y borrado`, async () => {
    const before = await snapshot();
    assert.equal((await call(direction, 1, null)).status, 401);
    assert.equal((await call(direction, 999, 4)).status, 404);
    assert.equal((await call(direction, 6, 5)).status, 404);
    assert.equal((await call(direction, 6, 4)).status, 404);
    assert.deepEqual(await snapshot(), before);
  });
  test(`${direction}: un trato permite leer pero no controlar ocupacion`, async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    const read = await request(app).get('/api/garage/7').set('Authorization', `Bearer ${token}`);
    assert.equal(read.status, 200, read.text);
    const before = await snapshot();
    assert.equal((await call(direction, 7, 1)).status, 404);
    assert.deepEqual(await snapshot(), before);
  });
  test(`${direction}: IDs invalidos no se truncan ni modifican recursos`, async () => {
    const before = await snapshot();
    for (const id of ['0','-1','1abc','1.5','abc','9007199254740992']) {
      assert.equal((await call(direction, id, 5)).status, 400, id);
    }
    assert.deepEqual(await snapshot(), before);
  });
  test(`${direction}: fallo SQL de escritura revierte todos los efectos`, async () => {
    await db.query('UPDATE garages SET ocupacion_no_reservas=1 WHERE id=1');
    await db.exec(`CREATE FUNCTION fail_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE garages SET ocupacion_no_reservas=99 WHERE id=2;
      RAISE EXCEPTION 'occupancy_write_failure'; END $$;
      CREATE TRIGGER fail_occupancy AFTER UPDATE ON garages FOR EACH ROW WHEN (NEW.id=1)
      EXECUTE FUNCTION fail_occupancy();`);
    const before = await snapshot();
    try {
      const res = await call(direction);
      assert.equal(res.status, 500, res.text);
      assert.match(res.body.message, /occupancy_write_failure/);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await db.exec('DROP TRIGGER fail_occupancy ON garages; DROP FUNCTION fail_occupancy();');
    }
  });
}
test('retirar asignacion impide nuevas operaciones, sin afectar otras asignaciones', async () => {
  assert.equal((await call('ingreso')).status, 200);
  await db.query('DELETE FROM usuario_garage WHERE id_usuario=5 AND id_garage=1');
  const before = await snapshot();
  assert.equal((await call('ingreso')).status, 404);
  assert.equal((await call('egreso')).status, 404);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await call('egreso', 1, 8)).status, 200);
});
test('payload y claims manipulados no conceden asignacion ni propiedad', async () => {
  const before = await snapshot();
  assert.equal((await call('ingreso', 2, 5, { id_usuario: 8, id_garages: [2] }, { id_rol: 4, id_garages: [2] })).status, 404);
  assert.equal((await call('ingreso', 5, 2, { id_empresa: 20, id_sede: 201 }, { id_empresa: 20, id_sede: 201 })).status, 404);
  assert.deepEqual(await snapshot(), before);
});
test('admin sin empresa y sede propietaria borrada no habilitan operacion', async () => {
  assert.equal((await call('ingreso', 3, 9)).status, 403);
  await db.query('UPDATE sedes SET "Borrado"=true WHERE id=101');
  const before = await snapshot();
  assert.equal((await call('ingreso', 3, 1)).status, 404);
  assert.equal((await call('egreso', 3, 1)).status, 404);
  assert.deepEqual(await snapshot(), before);
});
for (const [name, patch] of [
  ['cupo sin reserva lleno', 'ocupacion_no_reservas=2'],
  ['total lleno por reservas', 'capacidad_para_no_reservas=3,ocupacion_no_reservas=1,ocupacion_reservas=2'],
  ['cupo sin reserva cero', 'capacidad_para_no_reservas=0'],
  ['capacidad total cero', 'capacidad=0,capacidad_para_no_reservas=NULL'],
]) test(`capacidad: ${name}`, async () => {
  await db.exec(`UPDATE garages SET ${patch} WHERE id=1`);
  const before = await snapshot();
  const res = await call('ingreso');
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(await snapshot(), before);
});
test('capacidad sin reserva NULL usa la capacidad total; egreso en cero es 200 sin negativos', async () => {
  await db.exec('UPDATE garages SET capacidad_para_no_reservas=NULL,ocupacion_no_reservas=2 WHERE id=1');
  assert.equal((await call('ingreso')).body.ocupacion_no_reservas, 3);
  assert.equal((await call('ingreso')).status, 400);
  for (let i=0;i<5;i++) {
    const res = await call('egreso');
    assert.equal(res.status, 200, res.text);
    assert.ok(res.body.ocupacion_no_reservas >= 0);
  }
  assert.equal((await garage(1)).ocupacion_no_reservas, 0);
});
test('ocupaciones NULL conservan COALESCE a cero', async () => {
  await db.exec('UPDATE garages SET ocupacion_no_reservas=NULL,ocupacion_reservas=NULL WHERE id=1');
  assert.equal((await call('egreso')).body.ocupacion_no_reservas, 0);
  assert.equal((await call('ingreso')).body.ocupacion_no_reservas, 1);
});
test('solicitudes HTTP simultaneas respetan ambos limites y los egresos no son negativos', async () => {
  await db.exec('UPDATE garages SET ocupacion_reservas=1 WHERE id=1');
  const entries = await Promise.all(Array.from({ length: 12 }, () => call('ingreso')));
  assert.equal(entries.filter(r => r.status === 200).length, 2);
  assert.equal(entries.filter(r => r.status === 400).length, 10);
  const current = await garage(1);
  assert.equal(current.ocupacion_no_reservas, 2);
  assert.equal(current.ocupacion_no_reservas + current.ocupacion_reservas, 3);
  const exits = await Promise.all(Array.from({ length: 12 }, () => call('egreso')));
  assert.ok(exits.every(r => r.status === 200 && r.body.ocupacion_no_reservas >= 0));
  assert.equal((await garage(1)).ocupacion_no_reservas, 0);
});
test('servicio sin actor y roles prohibidos fallan cerrados', async () => {
  const svc = new GarageService();
  const before = await snapshot();
  for (const method of ['registrarIngresoNoReservaAsync','registrarEgresoNoReservaAsync']) {
    await assert.rejects(() => svc[method](1), { statusCode: 401 });
    await assert.rejects(() => svc[method](1, { id: 6, id_rol: 5 }), { statusCode: 403 });
  }
  assert.deepEqual(await snapshot(), before);
});
test('SQL del repositorio conserva permiso y limites incluso con lectura anterior', async () => {
  const { default: Repository } = await import('../src/repositories/garageRepository.js');
  const { authorizeGarageOccupancy } = await import('../src/helpers/garageOccupancyAuthorization.js');
  const repo = new Repository();
  const scope = authorizeGarageOccupancy({ id: 5, id_rol: 3 });
  await garage(1); // Una lectura antigua no habilita escribir tras una revocacion.
  await db.query('DELETE FROM usuario_garage WHERE id_usuario=5 AND id_garage=1');
  const before = await snapshot();
  for (const method of ['incrementOcupacionNoReservasAsync','decrementOcupacionNoReservasAsync']) {
    assert.equal(await repo[method](1, scope), null);
    assert.equal(await repo[method](1), null);
    assert.equal(await repo[method](1, { kind: 'global' }), null);
    assert.equal(await repo[method](1, { kind: 'global', actorId: 5, roleId: 4 }), null);
  }
  assert.deepEqual(await snapshot(), before);
  const superScope = authorizeGarageOccupancy({ id: 4, id_rol: 4 });
  const updated = await Promise.all(Array.from({ length: 12 }, () => repo.incrementOcupacionNoReservasAsync(1, superScope)));
  assert.equal(updated.filter(Boolean).length, 2);
  assert.equal((await garage(1)).ocupacion_no_reservas, 2);
});

for (const direction of ['ingreso','egreso']) for (const [name,actor,id,sql,code] of [
  ['asignacion retirada',5,1,'DELETE FROM usuario_garage WHERE id_usuario=5 AND id_garage=1',404],
  ['propiedad transferida',1,3,'UPDATE garages SET id_sede_propia=201 WHERE id=3',404],
  ['empresa propietaria cambiada',1,3,'UPDATE sedes SET id_empresa=20 WHERE id=101',404],
  ['garage movido de sede',2,3,'UPDATE garages SET id_sede_propia=102 WHERE id=3',404],
  ['empresa del actor cambiada',1,3,'UPDATE usuarios SET id_empresa=20 WHERE id=1',401],
  ['sede del actor cambiada',2,3,'UPDATE usuarios SET id_sede=102 WHERE id=2',401],
  ['rol del actor cambiado',5,1,'UPDATE usuarios SET id_rol=2 WHERE id=5',401],
]) test(`${direction} retenido: ${name} antes de adquirir bloqueos impide operar`, { timeout: 5000 }, async () => {
  if (direction === 'egreso') await db.query('UPDATE garages SET ocupacion_no_reservas=1 WHERE id=$1',[id]);
  const gate = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  connectionGate = gate;
  const pending = call(direction, id, actor).then(r => r);
  let before;
  try {
    await gate.started.promise; // El middleware ya valido JWT y leyo el contexto anterior.
    await db.exec(sql); // Escritura confirmada antes del BEGIN de la operacion retenida.
    before = await snapshot();
  } finally { gate.release.resolve(); }
  const res = await pending;
  assert.equal(res.status, code, res.text);
  assert.deepEqual(await snapshot(), before);
});
test('fallo SQL de lectura se propaga como 500, sin confundirse con garage inexistente', async () => {
  const before = await snapshot();
  await db.exec('ALTER TABLE garages RENAME TO unavailable_garages');
  try {
    const res = await call('ingreso');
    assert.equal(res.status, 500, res.text);
    assert.match(res.body.message, /garages/);
  } finally { await db.exec('ALTER TABLE unavailable_garages RENAME TO garages'); }
  assert.deepEqual(await snapshot(), before);
});

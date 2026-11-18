// Re-auditoría de seguridad (rama security-improvement): cada caso reproduce un hueco
// que seguía abierto después de SEG-01..SEG-10 y verifica el arreglo con PostgreSQL
// aislado (PGlite), controllers, middleware, servicios y SQL reales.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const db = new PGlite();
let tail = Promise.resolve();
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
mock.module('../src/services/emailService.js', { namedExports: { enviarCorreoDesdePlantilla: async () => {} } });
process.env.JWT_SECRET = 'seg11-isolated-test-secret';
process.env.BCRYPT_ROUNDS = '4';

const { default: auth } = await import('../src/middlewares/authMiddleware.js');
const { default: errorHandler } = await import('../src/middlewares/errorHandler.js');
const { default: vehiculos } = await import('../src/controllers/vehiculoController.js');
const { default: reservas } = await import('../src/controllers/reservaController.js');
const { default: usuarios } = await import('../src/controllers/usuarioController.js');
const { hasRole } = await import('../src/helpers/roles.js');
const { isTotalReversal, releaseReservationAfterReversal } = await import('../src/services/reservationPaymentReversal.js');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => { req.body ??= {}; next(); });
app.use('/vehiculos', auth, vehiculos);
app.use('/reservas', auth, reservas);
app.use('/usuarios', usuarios);
app.use(errorHandler);

const tokenOf = async (id) => {
  const { token_version } = (await db.query('SELECT token_version FROM usuarios WHERE id=$1', [id])).rows[0];
  return jwt.sign({ id, token_version }, process.env.JWT_SECRET, { expiresIn: '15m' });
};
const call = async (method, url, actor, body = {}) => {
  const req = request(app)[method](url);
  if (actor) req.set('Authorization', `Bearer ${typeof actor === 'string' ? actor : await tokenOf(actor)}`);
  return req.send(body);
};
const rows = async (table) => (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
const reserva = async (patch = {}) => {
  const r = { id_usuario: 7, id_vehiculo: 11, estado_reserva: 'confirmada', responsable_pago: 'empleado',
    tipo_cupo: 'dentro_cupo', importe_estimado: 100, retencion_pago_hasta: null, entro: false, ...patch };
  return (await db.query(`INSERT INTO reservas(id_usuario,id_garage,id_vehiculo,fecha_entrada,fecha_salida,dia,id_trato,
      modalidad_pago_aplicada,tipo_cupo,responsable_pago,tarifa_hora_aplicada,importe_estimado,estado_reserva,
      retencion_pago_hasta,entro)
    VALUES($1,1,$2,'2099-01-10 10:00:00','2099-01-10 11:00:00','Sabado',1,'empleado_paga_todo',$3,$4,100,$5,$6,$7,$8)
    RETURNING id`, [r.id_usuario, r.id_vehiculo, r.tipo_cupo, r.responsable_pago, r.importe_estimado,
    r.estado_reserva, r.retencion_pago_hasta, r.entro])).rows[0].id;
};

test.before(async () => {
  await db.exec(`
    CREATE TYPE estado_reserva_enum AS ENUM ('pendiente_pago','confirmada','expirada','cancelada');
    CREATE TABLE roles(id int PRIMARY KEY,tipo_rol text,"Borrado" boolean DEFAULT false);
    CREATE TABLE empresas(id int PRIMARY KEY,nombre text,"Borrado" boolean DEFAULT false);
    CREATE TABLE sedes(id int PRIMARY KEY,id_empresa int,nombre text,ubicacion text,latitud numeric,longitud numeric,
      "Borrado" boolean DEFAULT false);
    CREATE TABLE usuarios(id serial PRIMARY KEY,id_rol int,id_empresa int,id_sede int,nombre text,apellido text,
      email text,telefono text,contraseña text,activo boolean DEFAULT true,token_version int DEFAULT 0,
      limite_reservas_activas smallint,"Borrado" boolean DEFAULT false,"UpdateBy" int,"UpdateAt" timestamptz,
      "DeleteBy" int,"DeleteAt" timestamptz);
    CREATE TABLE usuario_garage(id_usuario int,id_garage int);
    CREATE TABLE refresh_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),usuario_id int,token_version int,
      refresh_token text,expires_at timestamptz);
    CREATE TABLE modelos(id int PRIMARY KEY,nombre text,tipo_vehiculo text,"Borrado" boolean DEFAULT false);
    CREATE TABLE vehiculos(id serial PRIMARY KEY,id_usuario int,id_modelo int,patente text,tipo_vehiculo text,
      "Borrado" boolean DEFAULT false);
    CREATE TABLE garages(id int PRIMARY KEY,nombre text,capacidad int,capacidad_reservas int,estado boolean DEFAULT true,
      id_sede_propia int,hora_apertura text,hora_cierre text,latitud numeric,longitud numeric,
      ocupacion_reservas int DEFAULT 0,"Borrado" boolean DEFAULT false);
    CREATE TABLE garage_dias(id_garage int,dia text,activo boolean DEFAULT true);
    CREATE TABLE trato_empresa_garage(id int PRIMARY KEY,id_sede int,id_garage int,cantidad_cocheras int,
      modalidad_pago text,precio_auto numeric,precio_moto numeric,precio_pickup numeric,"Borrado" boolean DEFAULT false);
    CREATE TABLE reservas(id serial PRIMARY KEY,id_usuario int,id_garage int,id_vehiculo int,fecha_entrada timestamp,
      fecha_salida timestamp,entro boolean DEFAULT false,salio boolean DEFAULT false,"Borrado" boolean DEFAULT false,
      dia text,id_trato int,modalidad_pago_aplicada text,tipo_cupo text,responsable_pago text,
      tarifa_hora_aplicada numeric,importe_estimado numeric,estado_reserva estado_reserva_enum,
      retencion_pago_hasta timestamptz,qr_token uuid DEFAULT gen_random_uuid(),qr_salida_token uuid);
    CREATE TABLE pagos(id serial PRIMARY KEY,id_reserva int,mp_preference_id text);
    INSERT INTO roles VALUES(1,'admin'),(2,'empleado'),(3,'garagista'),(4,'smartlot'),(5,'dueño_garage');
    INSERT INTO empresas VALUES(10,'A'),(20,'B');
    INSERT INTO modelos VALUES(1,'Gol','auto');
  `);
});

test.beforeEach(async () => {
  await db.exec(`TRUNCATE usuarios,usuario_garage,refresh_sessions,vehiculos,garages,garage_dias,
      trato_empresa_garage,reservas,pagos,sedes RESTART IDENTITY;
    INSERT INTO sedes(id,id_empresa,nombre) VALUES(101,10,'A1'),(201,20,'B1');
    INSERT INTO usuarios(id,id_rol,id_empresa,id_sede,nombre,apellido,email) VALUES
      (1,1,10,NULL,'Admin','A','a@test.test'),(3,1,20,NULL,'Admin','B','b@test.test'),
      (4,4,NULL,NULL,'Super','Admin','s@test.test'),(7,2,10,101,'Empleado','A','e7@test.test'),
      (9,2,20,201,'Empleado','B','e9@test.test'),(10,2,10,101,'Compa','A','e10@test.test');
    SELECT setval('usuarios_id_seq',100);
    INSERT INTO vehiculos(id,id_usuario,id_modelo,patente,tipo_vehiculo) VALUES
      (11,7,1,'AAA111','auto'),(12,10,1,'BBB222','auto'),(19,9,1,'CCC333','auto');
    SELECT setval('vehiculos_id_seq',100);
    INSERT INTO garages(id,nombre,capacidad,capacidad_reservas,id_sede_propia) VALUES
      (1,'Tercero',20,20,NULL),(2,'Propio A1',5,5,101);
    INSERT INTO trato_empresa_garage VALUES
      (1,101,1,10,'empleado_paga_todo',100,100,100),(2,201,1,10,'empleado_paga_todo',100,100,100),
      (3,101,2,5,'empresa_cubre_cupo',0,0,0);
  `);
  await db.query('UPDATE usuarios SET contraseña=$1', [await bcrypt.hash('Actual12!!AA', 4)]);
});
test.after(() => db.close());

test('vehiculos: un admin no edita, borra ni crea vehiculos de otra empresa', async () => {
  const before = await rows('vehiculos');
  assert.equal((await call('put', '/vehiculos/19', 1, { patente: 'ZZZ999' })).status, 404);
  assert.equal((await call('put', '/vehiculos/11', 1, { id_usuario: 9 })).status, 403);
  assert.equal((await call('delete', '/vehiculos/19', 1)).status, 404);
  const create = await call('post', '/vehiculos', 1, { id_usuario: 9, id_modelo: 1, patente: 'DDD444' });
  assert.equal(create.status, 403, create.text);
  assert.deepEqual(await rows('vehiculos'), before);
});

test('vehiculos: el admin sigue operando dentro de su empresa y el superadmin en todas', async () => {
  const own = await call('put', '/vehiculos/11', 1, { patente: 'AAA112' });
  assert.equal(own.status, 200, own.text);
  assert.equal(own.body.patente, 'AAA112');
  assert.equal((await call('post', '/vehiculos', 1, { id_usuario: 10, id_modelo: 1, patente: 'EEE555' })).status, 201);
  assert.equal((await call('delete', '/vehiculos/19', 4)).status, 200);
});

test('empleado: solo ve sus vehiculos y sus reservas, no las de sus companeros de sede', async () => {
  const ajena = await reserva({ id_usuario: 10, id_vehiculo: 12 });
  const propia = await reserva();
  const lista = await call('get', '/vehiculos', 7);
  assert.deepEqual(lista.body.map(v => v.id), [11]);
  assert.equal((await call('get', '/vehiculos/12', 7)).status, 404);
  assert.deepEqual((await call('get', '/reservas', 7)).body.map(r => r.id), [propia]);
  assert.equal((await call('get', `/reservas/${ajena}`, 7)).status, 404);
  assert.equal((await call('put', `/reservas/${ajena}`, 7, { fecha_salida: '2099-01-10T12:00:00' })).status, 404);
  // El admin de la empresa sigue viendo las dos.
  assert.deepEqual((await call('get', '/reservas', 1)).body.map(r => r.id).sort(), [ajena, propia].sort());
});

test('reserva pagada: extender el horario no conserva el importe viejo (409, nada cambia)', async () => {
  const id = await reserva();
  const before = await rows('reservas');
  const res = await call('put', `/reservas/${id}`, 7,
    { fecha_entrada: '2099-01-10T10:00:00', fecha_salida: '2099-01-10T20:00:00' });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, 'RESERVATION_REPRICE_REQUIRED');
  assert.deepEqual(await rows('reservas'), before);
});

test('reserva pendiente sin pago: la edicion se recotiza y el dia lo calcula el servidor', async () => {
  const id = await reserva({ estado_reserva: 'pendiente_pago', retencion_pago_hasta: '2099-01-01' });
  const res = await call('put', `/reservas/${id}`, 7,
    { fecha_entrada: '2099-01-12T10:00:00', fecha_salida: '2099-01-12T13:00:00', dia: 'Sabado' });
  assert.equal(res.status, 200, res.text);
  assert.equal(Number(res.body.importe_estimado), 300);
  assert.equal(res.body.dia, 'Lunes');
});

test('reserva pendiente con preferencia de pago emitida: no se puede cambiar el importe', async () => {
  const id = await reserva({ estado_reserva: 'pendiente_pago', retencion_pago_hasta: '2099-01-01' });
  await db.query("INSERT INTO pagos(id_reserva,mp_preference_id) VALUES($1,'pref-1')", [id]);
  const res = await call('put', `/reservas/${id}`, 7,
    { fecha_entrada: '2099-01-10T10:00:00', fecha_salida: '2099-01-10T15:00:00' });
  assert.equal(res.status, 409, res.text);
  assert.equal(Number((await rows('reservas'))[0].importe_estimado), 100);
});

test('reserva: mover al garage propio de la sede pasa a la empresa con el trato correcto', async () => {
  const id = await reserva({ estado_reserva: 'pendiente_pago', retencion_pago_hasta: '2099-01-01' });
  const res = await call('put', `/reservas/${id}`, 7, { id_garage: 2,
    fecha_entrada: '2099-01-10T10:00:00', fecha_salida: '2099-01-10T11:00:00' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.id_trato, 3);
  assert.equal(res.body.responsable_pago, 'empresa');
  assert.equal(res.body.estado_reserva, 'confirmada');
  assert.equal(res.body.retencion_pago_hasta, null);
});

test('sesion: despues del logout el mismo access token ya no sirve', async () => {
  const token = await tokenOf(7);
  assert.equal((await call('get', '/reservas', token)).status, 200);
  const logout = await request(app).post('/usuarios/logout').set('Cookie', `access_token=${token}`).send();
  assert.equal(logout.status, 200);
  const after = await call('get', '/reservas', token);
  assert.equal(after.status, 401);
  assert.match(after.body.message, /revocada/);
});

test('clave propia: exige la contrasena actual y despues revoca el token en uso', async () => {
  const token = await tokenOf(7);
  const sinActual = await call('patch', '/usuarios/7/contrasenia', token, { contraseña: 'NuEva12!!x' });
  assert.equal(sinActual.status, 400);
  assert.equal(sinActual.body.code, 'CURRENT_PASSWORD_INVALID');
  const incorrecta = await call('patch', '/usuarios/7/contrasenia', token,
    { contraseña: 'NuEva12!!x', contraseñaActual: 'Otra12!!XX' });
  assert.equal(incorrecta.status, 400);
  const ok = await call('patch', '/usuarios/7/contrasenia', token,
    { contraseña: 'NuEva12!!x', contraseñaActual: 'Actual12!!AA' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await call('get', '/reservas', token)).status, 401);
});

test('clave: una politica unica y fuerte, y el PUT ya no cambia la contrasena', async () => {
  const debil = await call('patch', '/usuarios/7/contrasenia', 1, { contraseña: 'Abcdefg1' });
  assert.equal(debil.status, 400);
  const put = await call('put', '/usuarios/7', 7, { contraseña: 'NuEva12!!x' });
  assert.equal(put.status, 400);
  const actual = (await db.query('SELECT contraseña FROM usuarios WHERE id=7')).rows[0].contraseña;
  assert.equal(await bcrypt.compare('Actual12!!AA', actual), true);
});

test('email propio: cambiarlo exige la contrasena actual (evita el robo de cuenta por recupero)', async () => {
  assert.equal((await call('put', '/usuarios/7', 7, { email: 'atacante@test.test' })).status, 400);
  const ok = await call('put', '/usuarios/7', 7, { email: 'nuevo@test.test', contraseñaActual: 'Actual12!!AA' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.email, 'nuevo@test.test');
  // Un admin corrige el email de un empleado de su empresa sin conocer su contraseña.
  assert.equal((await call('put', '/usuarios/10', 1, { email: 'compa@test.test' })).status, 200);
});

test('alta de garagista: el admin solo puede asignarlo al garage propio de su empresa', async () => {
  const body = (id_garage, email) => ({ id_rol: 3, nombre: 'Gara', apellido: 'Gista', email,
    contraseña: 'SeGura12!!', id_garage });
  const ajeno = await call('post', '/usuarios', 1, body(1, 'g1@test.test'));
  assert.equal(ajeno.status, 403, ajeno.text);
  assert.equal((await rows('usuario_garage')).length, 0);
  const propio = await call('post', '/usuarios', 1, body(2, 'g2@test.test'));
  assert.equal(propio.status, 201, propio.text);
  assert.deepEqual((await rows('usuario_garage')).map(r => r.id_garage), [2]);
});

test('roles: se autoriza por ID; los nombres de la base son alias y un nombre repetido no da permisos', () => {
  assert.equal(hasRole({ id_rol: 4, tipo_rol: 'smartlot' }, 'superadmin'), true);
  assert.equal(hasRole({ id_rol: 2, tipo_rol: 'empleado' }, 'cliente'), true);
  assert.equal(hasRole({ id_rol: 6, tipo_rol: 'admin' }, 'admin', 1), false);
  assert.equal(hasRole({ tipo_rol: 'smartlot' }, 4, 'superadmin'), false);
});

test('pago revertido: la reserva confirmada sin uso se cancela; una con ingreso se conserva', async () => {
  assert.equal(isTotalReversal({ status: 'charged_back', transaction_amount: 100 }), true);
  assert.equal(isTotalReversal({ status: 'refunded', transaction_amount: 100 }), true);
  assert.equal(isTotalReversal({ status: 'approved', transaction_amount: 100, transaction_amount_refunded: 40 }), false);
  const libre = await reserva();
  const usada = await reserva({ entro: true, id_vehiculo: 12, id_usuario: 10 });
  assert.equal(await releaseReservationAfterReversal(pool, libre), true);
  assert.equal(await releaseReservationAfterReversal(pool, usada), false);
  const [a, b] = await rows('reservas');
  assert.deepEqual([a.estado_reserva, a.Borrado], ['cancelada', true]);
  assert.deepEqual([b.estado_reserva, b.Borrado], ['confirmada', false]);
});

test('login: 10 intentos fallidos sobre la misma cuenta la bloquean 15 min sin afectar a otras', async () => {
  const intento = (email) => request(app).post('/usuarios/login').send({ email, contraseña: 'Incorrecta12!!' });
  for (let i = 0; i < 10; i++) assert.equal((await intento('e9@test.test')).status, 401);
  const bloqueado = await intento('e9@test.test');
  assert.equal(bloqueado.status, 429);
  assert.equal((await request(app).post('/usuarios/login').send({ email: 'e9@test.test', contraseña: 'Actual12!!AA' })).status, 429);
  assert.equal((await intento('e10@test.test')).status, 401);
});

test('check-in: un admin no registra el ingreso de una reserva de otra empresa en un garage con trato compartido', async () => {
  const ajena = await reserva({ id_usuario: 9, id_vehiculo: 19 });
  const before = await rows('reservas');
  const res = await call('post', `/reservas/${ajena}/check-in`, 1, { patente: 'CCC333' });
  assert.equal(res.status, 403, res.text);
  assert.deepEqual(await rows('reservas'), before);
  // El admin de la empresa titular sí pasa la autorización (lo que siga depende del horario).
  assert.notEqual((await call('post', `/reservas/${ajena}/check-in`, 3, { patente: 'CCC333' })).status, 403);
});

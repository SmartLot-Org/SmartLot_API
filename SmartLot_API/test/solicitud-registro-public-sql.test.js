import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

process.env.BCRYPT_ROUNDS = '4';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.NODE_ENV = 'test';
const db = new PGlite();
let failure, race, mailGate, mailFailure;
let mails = [];
let collisions = [];
let hashes = [];
const actualHash = bcrypt.hash.bind(bcrypt);
mock.method(bcrypt, 'hash', async (value, rounds) => {
  hashes.push(rounds);
  return actualHash(value, rounds);
});
const query = async (sql, params) => {
  if (failure === 'user' && sql.includes('WHERE u.email = $1')) throw new Error('Test SQL user failure');
  if (failure === 'pending' && sql.startsWith('SELECT id FROM solicitudes_registro')) throw new Error('Test SQL pending failure');
  if (failure && typeof failure === 'object' && sql.includes('INSERT INTO solicitudes_registro')) throw failure;
  const result = await db.query(sql, params).catch(error => { collisions.push(error); throw error; });
  if (race && sql.startsWith('SELECT id FROM solicitudes_registro')) {
    const current = race;
    current.reads++;
    if (current.reads === 2) current.release.resolve();
    await current.release.promise;
  }
  return result;
};
mock.module('../src/database/db.js', { defaultExport: { query } });
mock.module('../src/services/emailService.js', { namedExports: {
  enviarCorreoDesdePlantilla: async (...args) => {
    mails.push(args);
    if (mailGate) { mailGate.started.resolve(); await mailGate.release.promise; }
    if (mailFailure) throw new Error('Test mail unavailable');
  }
} });
const { default: router } = await import('../src/controllers/solicitudRegistroController.js');
const { default: errorHandler } = await import('../src/middlewares/errorHandler.js');
const app = express();
app.use(express.json());
app.use('/api/solicitud-registro', router);
app.use(errorHandler);
const path = '/api/solicitud-registro';
const ack = { message: 'Recibimos tu solicitud. Si corresponde procesarla, te contactaremos por correo. Si ya tenés una cuenta, podés iniciar sesión o recuperar tu contraseña.' };
const input = { nombre:'Ana',apellido:'Prueba',email:'new@example.test',contraseña:'SEgura12!!',
  telefono:'1123456789',empresa_nombre:'Empresa de prueba',empresa_descripcion:'Flota' };
const send = (changes = {}) => request(app).post(path).send({...input,...changes});
const drain = () => new Promise(resolve => setImmediate(resolve));
function assertAck(response) {
  assert.equal(response.status,202);
  assert.deepEqual(response.body,ack);
  assert.equal(response.headers['set-cookie'],undefined);
}
test.before(async () => {
  await db.exec(`CREATE TABLE roles(id int PRIMARY KEY,tipo_rol text,"Borrado" boolean DEFAULT false);
    CREATE TABLE usuarios(id int PRIMARY KEY,id_rol int,nombre text,apellido text,email text,contraseña text,
      activo boolean DEFAULT true,"Borrado" boolean DEFAULT false,id_empresa int,id_sede int,token_version int DEFAULT 0);
    CREATE TABLE usuario_garage(id_usuario int,id_garage int);
    INSERT INTO roles VALUES(1,'admin',false),(4,'superadmin',false);
    INSERT INTO usuarios(id,id_rol,nombre,email,contraseña) VALUES
      (1,1,'Existente','registered@example.test','unchanged-hash'),(99,4,'Super','super@example.test','unchanged-hash');`);
  await db.exec(await readFile(new URL('../migrations/20260909_001_solicitudes_registro.sql',import.meta.url),'utf8'));
});
test.beforeEach(async () => {
  await drain();
  failure = race = mailGate = null;
  mailFailure = false;
  mails = []; hashes = []; collisions = [];
  await db.exec('TRUNCATE solicitudes_registro RESTART IDENTITY');
});
test.after(() => db.close());

test('SEG-10B: nuevo, pendiente y usuario registrado tienen idéntico acuse público', async () => {
  const users = (await db.query('SELECT * FROM usuarios ORDER BY id')).rows;
  const created = await send({email:'  NEW@EXAMPLE.TEST ',estado:'aceptada',id_rol:4,id_empresa:99});
  await drain();
  const pending = (await db.query('SELECT * FROM solicitudes_registro')).rows;
  assert.equal(pending.length,1);
  assert.equal(pending[0].estado,'pendiente');
  assert.equal(pending[0].email,input.email);
  assert.equal(await bcrypt.compare(input.contraseña,pending[0].contraseña_hash),true);
  const duplicate = await send({nombre:'Otro',contraseña:'OTraClave34!!'});
  const registered = await send({email:'registered@example.test'});
  assert.deepEqual([created.status,duplicate.status,registered.status],[202,202,202]);
  [created,duplicate,registered].forEach(assertAck);
  await drain();
  assert.deepEqual((await db.query('SELECT * FROM solicitudes_registro')).rows,pending);
  assert.deepEqual((await db.query('SELECT * FROM usuarios ORDER BY id')).rows,users);
  assert.deepEqual(hashes,[4,4,4]);
  assert.equal(mails.length,1);
});

test('concurrencia: el índice real deja una solicitud y solo la creación notifica', async () => {
  race = { reads:0,release:Promise.withResolvers() };
  const responses = await Promise.all([send({nombre:'Primera'}),send({nombre:'Segunda'})]);
  responses.forEach(assertAck);
  await drain();
  assert.equal((await db.query('SELECT count(*) FROM solicitudes_registro')).rows[0].count,1);
  assert.equal(collisions.length,1);
  assert.equal(collisions[0].code,'23505');
  assert.equal(collisions[0].constraint,'uq_solicitudes_registro_email_pendiente');
  assert.equal(mails.length,1);
  assert.deepEqual(hashes,[4,4]);
});

test('correo bloqueado no bloquea HTTP; rechazo de correo sigue siendo best-effort', async () => {
  mailGate = { started:Promise.withResolvers(),release:Promise.withResolvers() };
  mailFailure = true;
  try {
    const response = await send();
    assertAck(response);
    await mailGate.started.promise;
    assertAck(await send());
    assertAck(await send({email:'registered@example.test'}));
    assert.equal(mails.length,1);
  } finally { mailGate.release.resolve(); }
  await drain();
  assert.equal(mails.length,1);
});

for (const problem of ['user','pending',
  {code:'23505',constraint:'other_unique_index'},
  {code:'23505',message:'uq_solicitudes_registro_email_pendiente'},
  {code:'08006',constraint:'uq_solicitudes_registro_email_pendiente'}]) {
  test(`error SQL real no es 202: ${JSON.stringify(problem)}`,async () => {
    failure = problem;
    const response = await send();
    assert.equal(response.status,500);
    assert.equal(response.body.message,'Error interno del servidor');
    assert.equal(response.headers['set-cookie'],undefined);
    assert.equal((await db.query('SELECT count(*) FROM solicitudes_registro')).rows[0].count,0);
    assert.equal(mails.length,0);
  });
}

test('permisos protegidos y validaciones conservados',async () => {
  assert.equal((await send({contraseña:'debil'})).status,400);
  assert.equal(hashes.length,0);
  for (const [method,url] of [['get',path],['get',`${path}/1`],['patch',`${path}/1/aprobar`],['patch',`${path}/1/rechazar`]]) {
    assert.equal((await request(app)[method](url)).status,401);
    const token = jwt.sign({id:1},process.env.JWT_SECRET);
    assert.equal((await request(app)[method](url).set('Authorization',`Bearer ${token}`)).status,403);
  }
});

test('rate limiter conserva 429',async () => {
  for (let i=0;i<101;i++) {
    const response = await send({contraseña:'debil'});
    if (response.status===429) { assert.ok(response.headers['retry-after']); return; }
    assert.equal(response.status,400);
  }
  assert.fail('debe limitar intentos');
});

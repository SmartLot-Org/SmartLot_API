import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.BCRYPT_ROUNDS = '4';
process.env.NODE_ENV = 'test';
const password = 'SEgura12!!';
const realHash = bcrypt.hash.bind(bcrypt);
const storedHash = await realHash(password, 4);
const realCompare = bcrypt.compare.bind(bcrypt);
const comparisons = [];
const hashCalls = [];
let dummyPassword;
mock.method(bcrypt, 'compare', async (plain, hash) => {
  comparisons.push(hash);
  return realCompare(plain, hash);
});
mock.method(bcrypt, 'hash', (...args) => {
  dummyPassword = args[0];
  hashCalls.push(args[1]);
  return realHash(...args);
});
const db = new PGlite();
let failRead = false;
let failSession = false;
let statements = [];
mock.module('../src/database/db.js', { defaultExport: {
  query: async (sql, params) => {
    statements.push(sql);
    if (failRead && sql.includes('WHERE u.email = $1')) throw new Error('Test SQL read failure');
    if (failSession === 'null' && sql.includes('INSERT INTO refresh_sessions')) return { rows: [{ id: null }] };
    if (failSession && sql.includes('INSERT INTO refresh_sessions')) throw new Error('Test session failure');
    return db.query(sql, params);
  }
} });
mock.module('../src/services/emailService.js', { namedExports: {
  enviarCorreoDesdePlantilla: async () => { throw new Error('No debe enviar correo'); }
} });
const { default: router } = await import('../src/controllers/usuarioController.js');
const { default: errorHandler } = await import('../src/middlewares/errorHandler.js');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/usuario', router);
app.use(errorHandler);
const login = (email, plain = 'incorrecta') => request(app).post('/api/usuario/login')
  .set('Cookie', 'access_token=previous; refresh_session_id=previous-session')
  .send({ email, contraseña: plain });
const sessionState = async () => (await db.query('SELECT * FROM refresh_sessions ORDER BY id')).rows;
const generic = { error: true, message: 'Credenciales incorrectas.', statusCode: 401 };

test.before(async () => {
  await db.exec(`CREATE TABLE roles(id int PRIMARY KEY,tipo_rol text,"Borrado" boolean DEFAULT false);
    CREATE TABLE usuarios(id int PRIMARY KEY,id_rol int,email text,contraseña text,activo boolean,"Borrado" boolean,
      id_empresa int,id_sede int,token_version int);
    CREATE TABLE usuario_garage(id_usuario int,id_garage int);
    CREATE TABLE refresh_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),usuario_id int,
      token_version int,refresh_token text,expires_at timestamptz);
    INSERT INTO roles(id,tipo_rol) VALUES(2,'empleado');`);
});
test.beforeEach(async () => {
  failRead = failSession = false;
  comparisons.length = 0;
  statements = [];
  await db.exec(`TRUNCATE usuarios,refresh_sessions;
    INSERT INTO usuarios VALUES
    (1,2,'active@example.test',null,true,false,10,101,7),
    (2,2,'inactive@example.test',null,false,false,10,101,7),
    (3,2,'deleted@example.test',null,true,true,10,101,7),
    (4,2,'nohash@example.test',null,true,false,10,101,7);`);
  await db.query('UPDATE usuarios SET contraseña=$1 WHERE id<4', [storedHash]);
  await db.query(`INSERT INTO refresh_sessions(usuario_id,token_version,refresh_token,expires_at)
    VALUES(1,7,$1,'2099-01-01')`, [jwt.sign({ id:1,token_version:7,type:'refresh' },process.env.JWT_REFRESH_SECRET)]);
});
test.after(() => db.close());

test('SEG-10A: todos los fallos válidos comparten 401/cuerpo y no alteran sesiones ni cookies', async () => {
  const before = await sessionState();
  for (const [email, plain] of [
    ['missing@example.test','incorrecta'], ['active@example.test','incorrecta'],
    ['inactive@example.test','incorrecta'], ['inactive@example.test',password],
    ['deleted@example.test','incorrecta'], ['deleted@example.test',password],
  ]) {
    const response = await login(email, plain);
    assert.equal(response.status, 401, email);
    assert.deepEqual(response.body, generic);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers['www-authenticate'], undefined);
    assert.deepEqual(await sessionState(), before);
  }
  assert.equal(statements.some(sql => /INSERT INTO refresh_sessions|DELETE FROM|UPDATE usuarios/.test(sql)), false);
});

test('SEG-10A: ausencia/hash inválido hacen bcrypt real con el mismo señuelo y costo configurado', async () => {
  for (const hash of [null, '', 'not-bcrypt']) {
    await db.query('UPDATE usuarios SET contraseña=$1 WHERE id=4', [hash]);
    const response = await login('nohash@example.test', password);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, generic);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  await login('missing@example.test', password);
  assert.equal(comparisons.length, 4);
  assert.equal(new Set(comparisons).size, 1);
  assert.equal(bcrypt.getRounds(comparisons[0]), 4);
  assert.notEqual(comparisons[0], storedHash);
  assert.deepEqual(hashCalls, [4], 'el hash señuelo se genera una vez por proceso');
});

test('cuenta desactivada compara el hash real antes del rechazo genérico', async () => {
  assert.equal((await login('inactive@example.test', password)).status, 401);
  assert.deepEqual(comparisons, [storedHash]);
});

for (const failure of ['read','session','null']) test(`SQL ${failure} sigue siendo 500, sin nueva sesión/cookies`, async () => {
  const before = await sessionState();
  failRead = failure === 'read';
  failSession = failure === 'null' ? 'null' : failure === 'session';
  const response = await login('active@example.test', password);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {error:true,message:'Error interno del servidor',statusCode:500});
  assert.equal(response.headers['set-cookie'], undefined);
  assert.deepEqual(await sessionState(), before);
});

test('login válido conserva claims, cookies y refresh real; contraseña almacenada no cambia', async () => {
  const response = await login('active@example.test', password);
  assert.equal(response.status, 200);
  const claims = jwt.verify(response.body.access_token, process.env.JWT_SECRET);
  assert.equal(claims.id, 1);
  assert.equal(claims.id_rol, 2);
  assert.equal(claims.id_empresa, 10);
  assert.equal(claims.id_sede, 101);
  assert.equal(claims.token_version, 7);
  assert.equal(response.body.usuario.contraseña, undefined);
  assert.deepEqual(comparisons, [storedHash]);
  assert.equal(response.headers['set-cookie'].length, 2);
  const cookie = response.headers['set-cookie'].find(c=>c.startsWith('refresh_session_id='));
  assert.match(cookie,/Path=\/api\/usuario\/refresh;.*HttpOnly; SameSite=Lax/);
  const refreshed = await request(app).post('/api/usuario/refresh').set('Cookie',cookie.split(';')[0]);
  assert.equal(refreshed.status,200);
  assert.equal(jwt.verify(refreshed.body.access_token,process.env.JWT_SECRET).id,1);
  assert.equal((await db.query('SELECT contraseña FROM usuarios WHERE id=1')).rows[0].contraseña,storedHash);
});

test('formato inválido conserva 400 sin consulta ni bcrypt', async () => {
  const response = await login('invalid-email',password);
  assert.equal(response.status,400);
  assert.equal(comparisons.length,0);
  assert.equal(statements.length,0);
});

test('ni acertar la contraseña del señuelo puede autorizar una cuenta inexistente o sin hash', async () => {
  const before = await sessionState();
  for (const email of ['missing@example.test','nohash@example.test']) {
    const response = await login(email,dummyPassword);
    assert.equal(response.status,401);
    assert.deepEqual(response.body,generic);
    assert.equal(response.headers['set-cookie'],undefined);
    assert.equal(await realCompare(dummyPassword,comparisons.at(-1)),true);
  }
  assert.deepEqual(await sessionState(),before);
});

test('getByEmailAsync propaga el error SQL en lugar de devolver null (no existe != falló la consulta)', async () => {
  const { default: Repository } = await import('../src/repositories/usuarioRepository.js');
  const repo = new Repository();
  failRead = true;
  await assert.rejects(repo.getByEmailAsync('active@example.test'),/Test SQL read failure/);
  failRead = false;
  assert.equal(await repo.getByEmailAsync('missing@example.test'),null);
});

test('el rate limiter mantiene 429 y el 403 de autorización protegida no cambia', async () => {
  const access = jwt.sign({id:1,token_version:7},process.env.JWT_SECRET);
  const denied = await request(app).get('/api/usuario').set('Cookie',`access_token=${access}`);
  assert.equal(denied.status,403);
  for (let i=0;i<101;i++) {
    const response = await login('invalid-email',password);
    if (response.status === 429) {
      assert.equal(response.body.statusCode,429);
      assert.ok(response.headers['retry-after']);
      assert.equal(response.headers['set-cookie'],undefined);
      return;
    }
    assert.equal(response.status,400);
  }
  assert.fail('el limitador debe responder 429');
});

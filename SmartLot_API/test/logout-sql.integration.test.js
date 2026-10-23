import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

// Secretos efimeros exclusivos de este proceso de pruebas; nunca se usa .env.
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.BCRYPT_ROUNDS = '4';
process.env.NODE_ENV = 'test';
const wrongSecret = randomBytes(48).toString('hex');
const db = new PGlite();
let tail = Promise.resolve();
let deleteGate;
let commitGate;
let connectionGate;
let connections = 0;
let statements = [];
let finishedLogouts = 0;
let logoutCookieNames = [];
const query = async (sql, params) => {
  statements.push(sql);
  if (/DELETE FROM refresh_sessions WHERE usuario_id/i.test(sql) && deleteGate) {
    const gate = deleteGate;
    deleteGate = null;
    gate.started.resolve();
    await gate.release.promise;
  }
  if (sql === 'COMMIT' && commitGate) {
    const gate = commitGate;
    commitGate = null;
    gate.started.resolve();
    await gate.release.promise;
  }
  return db.query(sql, params);
};
const pool = {
  query,
  connect: async () => {
    connections++;
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
    return { query, release: done.resolve };
  }
};
mock.module('../src/database/db.js', { defaultExport: pool });
mock.module('../src/services/emailService.js', { namedExports: { enviarCorreoDesdePlantilla: async () => {
  throw new Error('Logout/login/refresh no deben enviar correo');
} } });
const { default: router } = await import('../src/controllers/usuarioController.js');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path === '/api/usuario/logout') logoutCookieNames.push(Object.keys(req.cookies));
  res.on('finish', () => { if (req.path === '/api/usuario/logout') finishedLogouts++; });
  next();
});
app.get('/probe', (req, res) => res.sendStatus(204));
app.use('/api/usuario', router);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
const sign = (claims = {}, options = {}) => jwt.sign({ id: 9, token_version: 7, ...claims }, process.env.JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '15m', ...options });
const logout = (token, body = {}, target = '/api/usuario/logout') => {
  const req = request(app).post(target);
  if (token) req.set('Cookie', `access_token=${token}`);
  return req.send(body);
};
const state = async () => ({
  users: (await db.query('SELECT * FROM usuarios ORDER BY id')).rows,
  sessions: (await db.query('SELECT * FROM refresh_sessions ORDER BY id')).rows.map(({ refresh_token, ...row }) => ({
    ...row, tokenDigest: createHash('sha256').update(refresh_token).digest('hex')
  }))
});
test.before(async () => {
  await db.exec(`CREATE TABLE roles(id int PRIMARY KEY,tipo_rol text,"Borrado" boolean DEFAULT false);
    CREATE TABLE usuarios(id int PRIMARY KEY,id_rol int,nombre text,apellido text,email text,contraseña text,
      id_empresa int,id_sede int,activo boolean DEFAULT true,"Borrado" boolean DEFAULT false,
      token_version int DEFAULT 7,"UpdateBy" int,"UpdateAt" timestamptz);
    CREATE TABLE usuario_garage(id_usuario int,id_garage int);
    CREATE TABLE refresh_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),usuario_id int REFERENCES usuarios(id),
      token_version int,refresh_token text,expires_at timestamptz);
    INSERT INTO roles VALUES(2,'cliente');`);
});
test.beforeEach(async () => {
  deleteGate = null; commitGate = null; connectionGate = null; connections = 0; statements = []; finishedLogouts = 0; logoutCookieNames = [];
  await db.exec(`TRUNCATE usuarios,refresh_sessions CASCADE;
    INSERT INTO usuarios(id,id_rol,nombre,apellido,email) VALUES
      (8,2,'Otro','Usuario','otro@test.test'),(9,2,'Usuario','Objetivo','objetivo@test.test');`);
  const hash = await bcrypt.hash('Segura12!!', 4);
  await db.query('UPDATE usuarios SET contraseña=$1', [hash]);
  for (const id of [8,9]) await db.query(`INSERT INTO refresh_sessions(usuario_id,token_version,refresh_token,expires_at)
    VALUES($1,7,$2,'2099-01-01')`, [id, jwt.sign({ id,token_version:7,type:'refresh' },process.env.JWT_REFRESH_SECRET,{ expiresIn:'30d' })]);
});
test.after(() => db.close());

test('reproduccion logout: JWT de firma incorrecta no revoca al usuario indicado', async () => {
  const before = await state();
  const forged = jwt.sign({ id: 9, token_version: 7 }, wrongSecret, { expiresIn: '15m' });
  const res = await logout(forged);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(await state(), before);
  clearedCookies(res);
  assert.equal(connections, 0);
  assert.equal(statements.length, 0);
});

function clearedCookies(res, secure = false) {
  const headers = res.headers['set-cookie'] || [];
  for (const [name, path] of [['access_token','/'],['refresh_session_id','/api/usuario/refresh']]) {
    const cookie = headers.find(c => c.startsWith(`${name}=`));
    assert.ok(cookie, `${name} debe eliminarse`);
    assert.equal(cookie.split(';')[0], `${name}=`);
    const attributes = cookie.split(';').slice(1).map(p => p.trim().toLowerCase());
    assert.ok(attributes.includes(`path=${path}`));
    assert.ok(attributes.includes('httponly'));
    assert.ok(attributes.includes('samesite=lax'));
    assert.equal(attributes.includes('secure'), secure);
    const expiration = attributes.find(a => a.startsWith('expires='));
    assert.ok(expiration && Date.parse(expiration.slice(8)) < Date.now());
  }
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
for (const [name, getToken] of [
  ['sin token', () => null],
  ['malformado', () => 'no-es-un-jwt'],
  ['payload alterado sin volver a firmar', () => {
    const parts = sign({ id: 8 }).split('.');
    parts[1] = encode({ id: 9, token_version: 7, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+900 });
    return parts.join('.');
  }],
  ['sin firma', () => jwt.sign({ id: 9, token_version: 7 }, null, { algorithm: 'none', expiresIn:'15m' })],
  ['HS384 no permitido', () => sign({}, { algorithm:'HS384' })],
  ['vencido', () => sign({}, { expiresIn:-1 })],
  ['todavia no valido', () => sign({}, { notBefore:'1h' })],
  ['refresh firmado con clave de access', () => sign({ type:'refresh' })],
  ['tipo desconocido', () => sign({ type:'otro' })],
  ['id string', () => sign({ id:'9' })],
  ['id ausente', () => sign({ id:undefined })],
  ['id cero', () => sign({ id:0 })],
  ['id negativo', () => sign({ id:-9 })],
  ['id fuera de integer', () => sign({ id:2147483648 })],
  ['id booleano', () => sign({ id:true })],
  ['version ausente', () => sign({ token_version:undefined })],
  ['version string', () => sign({ token_version:'7' })],
  ['version negativa', () => sign({ token_version:-1 })],
  ['version fraccionaria', () => sign({ token_version:7.5 })],
  ['version nula', () => sign({ token_version:null })],
  ['sin expiracion', () => jwt.sign({ id:9, token_version:7 }, process.env.JWT_SECRET)],
  ['sin fecha de emision', () => sign({}, { noTimestamp:true })],
  ['payload string', () => jwt.sign('usuario9', process.env.JWT_SECRET)]
]) test(`credencial invalida ${name}: 200, cookies limpias, sin consultas ni revocacion`, async () => {
  const before = await state();
  const res = await logout(getToken());
  assert.equal(res.status, 200);
  clearedCookies(res);
  assert.deepEqual(await state(), before);
  assert.equal(connections, 0);
  assert.equal(statements.length, 0);
});
test('refresh real no se acepta como access incluso si las claves coinciden', async () => {
  const previous = process.env.JWT_REFRESH_SECRET;
  try {
    process.env.JWT_REFRESH_SECRET = process.env.JWT_SECRET;
    const refresh = jwt.sign({ id:9, token_version:7, type:'refresh' }, process.env.JWT_REFRESH_SECRET, { expiresIn:'30d' });
    const before = await state();
    const res = await logout(refresh);
    assert.equal(res.status, 200);
    assert.deepEqual(await state(), before);
    assert.equal(statements.length, 0);
  } finally { process.env.JWT_REFRESH_SECRET = previous; }
});
test('token valido y vigente revoca solo al usuario verificado, sin cookie refresh', async () => {
  const before = await state();
  const res = await logout(sign());
  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Sesion cerrada exitosamente.');
  clearedCookies(res);
  assert.deepEqual(await state(), {
    users: before.users.map(u => u.id === 9 ? { ...u, token_version:8 } : u),
    sessions: before.sessions.filter(s => s.usuario_id !== 9)
  });
  assert.deepEqual(logoutCookieNames, [['access_token']]);
});
test('body y query ajenos no cambian el objetivo; Authorization no sustituye cookie', async () => {
  const before = await state();
  const noCookie = await request(app).post('/api/usuario/logout?id=9').set('Authorization', `Bearer ${sign()}`).send({ id:9 });
  assert.equal(noCookie.status, 200);
  assert.deepEqual(await state(), before);
  const res = await logout(sign({ id:8 }), { id:9, id_usuario:9, token_version:7 }, '/api/usuario/logout?id=9');
  assert.equal(res.status, 200);
  assert.deepEqual(await state(), {
    users: before.users.map(u => u.id === 8 ? { ...u, token_version:8 } : u),
    sessions: before.sessions.filter(s => s.usuario_id !== 8)
  });
});
test('cookie refresh_session_id por si sola no proporciona identidad para revocar', async () => {
  const session = (await db.query('SELECT id FROM refresh_sessions WHERE usuario_id=9')).rows[0];
  const before = await state();
  const res = await request(app).post('/api/usuario/logout').set('Cookie', `refresh_session_id=${session.id}`).send({ id:9 });
  assert.equal(res.status, 200);
  clearedCookies(res);
  assert.deepEqual(await state(), before);
  assert.equal(connections, 0);
});
for (const version of [6,8]) test(`version ${version} distinta de la persistida no revoca sesiones`, async () => {
  const before = await state();
  const res = await logout(sign({ token_version:version }));
  assert.equal(res.status, 200);
  clearedCookies(res);
  assert.deepEqual(await state(), before);
  assert.equal(statements.some(s => /DELETE FROM refresh_sessions/i.test(s)), false);
});
for (const [name, sql, id] of [
  ['inexistente', null,999], ['inactivo','UPDATE usuarios SET activo=false WHERE id=9',9],
  ['borrado','UPDATE usuarios SET "Borrado"=true WHERE id=9',9],
  ['version persistida NULL','UPDATE usuarios SET token_version=NULL WHERE id=9',9]
]) test(`usuario ${name}: sin revocacion`, async () => {
  if (sql) await db.exec(sql);
  const before = await state();
  const res = await logout(sign({ id }));
  assert.equal(res.status, 200);
  assert.deepEqual(await state(), before);
});
test('version cero vigente se revoca una sola vez y logout repetido es idempotente', async () => {
  await db.exec('UPDATE usuarios SET token_version=0 WHERE id=9');
  const token = sign({ token_version:0 });
  assert.equal((await logout(token)).status, 200);
  const after = await state();
  assert.equal(after.users.find(u => u.id === 9).token_version, 1);
  assert.equal(after.sessions.some(s => s.usuario_id === 9), false);
  assert.equal((await logout(token)).status, 200);
  assert.equal((await logout()).status, 200);
  assert.deepEqual(await state(), after);
});
test('login y refresh legitimos funcionan; cookie refresh conserva path y no se envia a logout', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/api/usuario/login').send({ email:'objetivo@test.test', contraseña:'Segura12!!' });
  assert.equal(login.status, 200);
  const access = jwt.verify(login.body.access_token, process.env.JWT_SECRET, { algorithms:['HS256'] });
  assert.equal(access.id, 9);
  assert.equal(access.token_version, 7);
  const sessionCookie = login.headers['set-cookie'].find(c => c.startsWith('refresh_session_id='));
  assert.ok(sessionCookie.split(';').slice(1).map(s => s.trim()).includes('Path=/api/usuario/refresh'));
  const firstSessionId = sessionCookie.split(';')[0].split('=')[1];
  const refreshed = await agent.post('/api/usuario/refresh');
  assert.equal(refreshed.status, 200);
  assert.equal(jwt.verify(refreshed.body.access_token, process.env.JWT_SECRET).token_version, 7);
  assert.equal((await db.query('SELECT id FROM refresh_sessions WHERE id=$1',[firstSessionId])).rows.length, 0);
  const out = await agent.post('/api/usuario/logout');
  assert.equal(out.status, 200);
  clearedCookies(out);
  assert.deepEqual(logoutCookieNames.at(-1), ['access_token']);
  assert.equal((await agent.post('/api/usuario/refresh')).status, 401);
});
test('reutilizar access antiguo despues de logout y nuevo login no revoca la sesion nueva', async () => {
  const token = sign();
  assert.equal((await logout(token)).status, 200);
  const login = await request(app).post('/api/usuario/login').send({ email:'objetivo@test.test', contraseña:'Segura12!!' });
  assert.equal(login.status, 200);
  assert.equal(jwt.verify(login.body.access_token, process.env.JWT_SECRET).token_version, 8);
  const before = await state();
  assert.equal((await logout(token)).status, 200);
  assert.equal((await logout(token)).status, 200);
  assert.deepEqual(await state(), before);
});
test('dos logout de la misma version no revocan una sesion creada entre sus transacciones', { timeout:5000 }, async () => {
  const firstGate = { started:Promise.withResolvers(), release:Promise.withResolvers() };
  const secondGate = { started:Promise.withResolvers(), release:Promise.withResolvers() };
  const token = sign();
  deleteGate = firstGate;
  const first = logout(token).then(r => r);
  let second;
  try {
    await firstGate.started.promise;
    connectionGate = secondGate;
    second = logout(token).then(r => r);
    await secondGate.started.promise;
    firstGate.release.resolve();
    assert.equal((await first).status, 200);
    const login = await request(app).post('/api/usuario/login').send({ email:'objetivo@test.test', contraseña:'Segura12!!' });
    assert.equal(login.status, 200);
    const before = await state();
    secondGate.release.resolve();
    assert.equal((await second).status, 200);
    assert.deepEqual(await state(), before);
    assert.equal(before.users.find(u => u.id === 9).token_version, 8);
    assert.equal(before.sessions.filter(s => s.usuario_id === 9).length, 1);
  } finally {
    firstGate.release.resolve(); secondGate.release.resolve();
    await first; if (second) await second;
  }
});
test('la respuesta espera el DELETE y el COMMIT, sin trabajo de revocacion en segundo plano', { timeout:5000 }, async () => {
  const gate = { started:Promise.withResolvers(), release:Promise.withResolvers() };
  const committing = { started:Promise.withResolvers(), release:Promise.withResolvers() };
  deleteGate = gate;
  commitGate = committing;
  const pending = logout(sign()).then(r => r);
  try {
    await gate.started.promise;
    assert.equal((await request(app).get('/probe')).status, 204);
    assert.equal(finishedLogouts, 0);
    gate.release.resolve();
    await committing.started.promise;
    assert.equal((await request(app).get('/probe')).status, 204);
    assert.equal(finishedLogouts, 0);
  } finally { gate.release.resolve(); committing.release.resolve(); }
  const res = await pending;
  assert.equal(res.status, 200);
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal((await state()).sessions.some(s => s.usuario_id === 9), false);
});
test('error SQL despues del incremento revierte toda la revocacion y limpia cookies', async () => {
  await db.exec(`CREATE FUNCTION fail_logout() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE usuarios SET token_version=99 WHERE id=8; RAISE EXCEPTION 'logout_delete_failure'; END $$;
    CREATE TRIGGER fail_logout BEFORE DELETE ON refresh_sessions FOR EACH ROW
    WHEN (OLD.usuario_id=9) EXECUTE FUNCTION fail_logout();`);
  const before = await state();
  try {
    const res = await logout(sign());
    assert.equal(res.status, 500);
    assert.match(res.body.message, /logout_delete_failure/);
    clearedCookies(res);
    assert.deepEqual(await state(), before);
  } finally { await db.exec('DROP TRIGGER fail_logout ON refresh_sessions; DROP FUNCTION fail_logout();'); }
  assert.equal((await logout(sign())).status, 200);
});
test('cookies mantienen Secure y paths en produccion incluso con credencial invalida', async () => {
  try {
    process.env.NODE_ENV = 'production';
    const before = await state();
    const res = await logout('token-malformado');
    assert.equal(res.status, 200);
    clearedCookies(res, true);
    assert.deepEqual(await state(), before);
  } finally { process.env.NODE_ENV = 'test'; }
});
test('fallo de configuracion no se confunde con credencial invalida y limpia cookies', async () => {
  const token = sign();
  const secret = process.env.JWT_SECRET;
  const before = await state();
  try {
    delete process.env.JWT_SECRET;
    const res = await logout(token);
    assert.equal(res.status, 500);
    clearedCookies(res);
    assert.deepEqual(await state(), before);
  } finally { process.env.JWT_SECRET = secret; }
});

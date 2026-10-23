import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { readFile } from 'node:fs/promises';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
process.env.BCRYPT_ROUNDS = '4';
process.env.NODE_ENV = 'test';
const db = new PGlite();
let tail = Promise.resolve();
let readGate;
let mails = [];
let transactionGate;
let connections = 0;
let sqlGate;
let secondConnection;
let ip = 0;
const query = async (sql, params) => {
  const result = await db.query(sql, params);
  if (sqlGate && sqlGate.matches(sql)) {
    const gate = sqlGate; sqlGate = null;
    gate.ready.resolve(); await gate.release.promise;
  }
  if (transactionGate && /FROM password_reset_codes/.test(sql) && /FOR UPDATE/.test(sql)) {
    const gate = transactionGate; transactionGate = null;
    gate.ready.resolve(); await gate.release.promise;
  }
  if (readGate && /FROM password_reset_codes/.test(sql) && !/FOR UPDATE/.test(sql)) {
    readGate.count++;
    if (readGate.count === 2) readGate.ready.resolve();
    await readGate.release.promise;
  }
  return result;
};
const pool = { query, connect: async () => {
  connections++;
  if (connections === 2) secondConnection?.resolve();
  if (connections === 2 && readGate) readGate.secondConnection.resolve();
  const previous = tail;
  const done = Promise.withResolvers(); tail = done.promise;
  await previous;
  return { query, release: done.resolve };
} };
mock.module('../src/database/db.js', { defaultExport: pool });
mock.module('../src/services/emailService.js', { namedExports: {
  enviarCorreoDesdePlantilla: async (...args) => { mails.push(args); }
} });
const { default: router } = await import('../src/controllers/usuarioController.js');
const { default: RecoveryService } = await import('../src/services/recoveryService.js');
const app = express(); app.use(express.json()); app.use(cookieParser());
app.set('trust proxy','loopback'); // IPs exclusivas del fixture para probar el limite persistido independientemente del IP.
app.use('/api/usuario', router);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Error interno' }));
const post = (path, codigo = '123456', extra = {}) => request(app).post(`/api/usuario/${path}`)
  .set('X-Forwarded-For',`198.18.${Math.floor(++ip/250)}.${ip%250+1}`)
  .send({ email: 'cuenta@test.test', codigo, contraseña: 'NuevaClave12!', ...extra });
const state = async () => ({
  users: (await db.query('SELECT * FROM usuarios ORDER BY id')).rows,
  sessions: (await db.query('SELECT * FROM refresh_sessions ORDER BY id')).rows
});
test.before(async () => {
  await db.exec(`CREATE TABLE usuarios(id int PRIMARY KEY,id_rol int,nombre text,apellido text,email text,
    contraseña text,id_empresa int,id_sede int,activo boolean DEFAULT true,"Borrado" boolean DEFAULT false,
    token_version int DEFAULT 7,"UpdateBy" int,"UpdateAt" timestamptz);
    CREATE TABLE roles(id int PRIMARY KEY,tipo_rol text,"Borrado" boolean DEFAULT false);
    INSERT INTO roles VALUES(2,'empleado');
    CREATE TABLE usuario_garage(id_usuario int,id_garage int);
    CREATE TABLE refresh_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),usuario_id int REFERENCES usuarios(id),
      token_version int,refresh_token text,expires_at timestamptz);
    CREATE TABLE password_reset_codes(id serial PRIMARY KEY,id_usuario int NOT NULL REFERENCES usuarios(id),
      codigo_hash text NOT NULL,usado boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL,
      creado_en timestamptz NOT NULL DEFAULT now());`);
  await db.exec(await readFile(new URL('../migrations/20261023020040_seg06_recovery_codes.sql',import.meta.url),'utf8'));
});
test.beforeEach(async () => {
  mails = []; readGate = null; transactionGate = null; connections = 0; sqlGate = null; secondConnection = null;
  await db.exec(`TRUNCATE usuarios,password_reset_codes,refresh_sessions CASCADE;
    INSERT INTO usuarios(id,id_rol,email) VALUES(9,2,'cuenta@test.test'),(8,2,'otra@test.test');
    INSERT INTO refresh_sessions(usuario_id,token_version,refresh_token,expires_at) VALUES(9,7,'fixture','2099-01-01');`);
  await db.query('UPDATE usuarios SET contraseña=$1', [await bcrypt.hash('Anterior12!',4)]);
  await db.query(`INSERT INTO password_reset_codes(id_usuario,codigo_hash,expires_at)
    VALUES(9,$1,now()+interval '10 minutes')`, [await bcrypt.hash('123456',4)]);
});
test.after(() => db.close());

const codeRow = async () => (await db.query('SELECT * FROM password_reset_codes ORDER BY id DESC LIMIT 1')).rows[0];
const gateAt = matches => (sqlGate = { matches, ready:Promise.withResolvers(),release:Promise.withResolvers() });
async function concurrent(firstOperation,secondOperation,matches = sql => /FROM password_reset_codes/.test(sql) && /FOR UPDATE/.test(sql)) {
  connections = 0;
  secondConnection = Promise.withResolvers();
  const gate = gateAt(matches);
  const first = firstOperation();
  await gate.ready.promise;
  const second = secondOperation();
  await secondConnection.promise;
  gate.release.resolve();
  return Promise.all([first,second]);
}

test('reproduccion: seis errores alternando endpoints agotan el codigo sin alterar usuario ni sesiones', async () => {
  const before = await state();
  for (let i=0;i<6;i++) assert.ok((await post(i%2 ? 'restablecer-clave' : 'login-con-codigo','000000')).status >= 400);
  const response = await post('login-con-codigo');
  assert.equal(response.status,401);
  assert.deepEqual(await state(), before);
});

test('reproduccion: dos lecturas simultaneas del codigo no crean dos sesiones', async () => {
  readGate = { count:0, ready:Promise.withResolvers(), secondConnection:Promise.withResolvers(), release:Promise.withResolvers() };
  transactionGate = { ready:Promise.withResolvers(), release:Promise.withResolvers() };
  const gate = readGate;
  const locked = transactionGate;
  const first = post('login-con-codigo').then(r=>r);
  const second = post('login-con-codigo').then(r=>r);
  await Promise.race([gate.ready.promise, Promise.all([locked.ready.promise,gate.secondConnection.promise])]);
  gate.release.resolve();
  locked.release.resolve();
  const responses = await Promise.all([first,second]);
  readGate = null;
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM refresh_sessions')).rows[0].n,2);
});

test('cuatro errores compartidos y un acierto; repetir no crea otra sesion', async () => {
  const before = await state();
  for (let i=0;i<4;i++) await post(i%2 ? 'restablecer-clave':'login-con-codigo','000000');
  assert.equal((await codeRow()).failed_attempts,4);
  assert.deepEqual(await state(),before);
  const success = await post('login-con-codigo');
  assert.equal(success.status,200,success.text);
  assert.ok(success.headers['set-cookie'].some(c=>c.startsWith('refresh_session_id=') && c.includes('Path=/api/usuario/refresh')));
  assert.equal(success.body.usuario.contraseña,undefined);
  assert.equal((await post('login-con-codigo')).status,401);
  assert.equal((await codeRow()).usado,true);
});

test('quinto error invalida; el contador persiste entre instancias del servicio', async () => {
  const before = await state();
  for (let i=0;i<5;i++) await assert.rejects(new RecoveryService().login('cuenta@test.test','000000'),{statusCode:401});
  assert.equal((await codeRow()).failed_attempts,5);
  assert.equal((await codeRow()).usado,true);
  assert.equal((await post('restablecer-clave')).status,400);
  assert.deepEqual(await state(),before);
  assert.equal((await post('login',undefined,{contraseña:'Anterior12!'})).status,200);
});

test('errores concurrentes conservan ambos incrementos sin superar cinco', async () => {
  await db.query('UPDATE password_reset_codes SET failed_attempts=3');
  const responses = await concurrent(
    ()=>post('login-con-codigo','000000').then(r=>r),
    ()=>post('restablecer-clave','000000').then(r=>r));
  assert.deepEqual(responses.map(r=>r.status),[401,400]);
  assert.equal((await codeRow()).failed_attempts,5);
  assert.equal((await codeRow()).usado,true);
  await post('login-con-codigo','000000');
  assert.equal((await codeRow()).failed_attempts,5);
});

for (const first of ['login-con-codigo','restablecer-clave']) test(`${first} y el otro consumo simultaneo: solo uno funciona`,async () => {
  const other = first === 'login-con-codigo' ? 'restablecer-clave' : 'login-con-codigo';
  const responses = await concurrent(()=>post(first).then(r=>r),()=>post(other).then(r=>r));
  assert.equal(responses[0].status,200,responses[0].text);
  assert.equal(responses[1].status,other === 'login-con-codigo' ? 401 : 400);
  assert.equal((await codeRow()).usado,true);
  const user = (await state()).users.find(u=>u.id===9);
  assert.equal(user.token_version,first === 'login-con-codigo' ? 7 : 8);
});

for (const [label,sql,extra] of [
  ['vencido',"UPDATE password_reset_codes SET expires_at=clock_timestamp()-interval '1 second'",{}],
  ['usado','UPDATE password_reset_codes SET usado=true',{}],
  ['otra cuenta',null,{email:'otra@test.test'}],
  ['inexistente',null,{email:'nadie@test.test'}],
  ['inactivo','UPDATE usuarios SET activo=false WHERE id=9',{}],
  ['borrado','UPDATE usuarios SET "Borrado"=true WHERE id=9',{}]
]) test(`${label}: rechaza ambos caminos sin efectos`,async()=>{
  if (sql) await db.exec(sql);
  const before = await state();
  const a = await post('login-con-codigo','123456',extra);
  const b = await post('restablecer-clave','123456',extra);
  assert.equal(a.status,401); assert.equal(b.status,400);
  assert.equal(a.body.message,b.body.message);
  assert.deepEqual(await state(),before);
});

test('la vigencia se vuelve a comprobar al consumir, despues de la comparacion',async()=>{
  const gate = gateAt(sql => /FROM password_reset_codes/.test(sql) && /FOR UPDATE/.test(sql));
  const response = post('login-con-codigo').then(r=>r);
  await gate.ready.promise;
  await db.exec("UPDATE password_reset_codes SET expires_at=clock_timestamp()-interval '1 second'");
  gate.release.resolve();
  assert.equal((await response).status,401);
  assert.equal((await codeRow()).usado,false);
});

test('recuperacion no revela cuenta ni limites; cooldown no invalida el codigo actual',async()=>{
  const current = await codeRow();
  const a = await post('recuperar-clave');
  const b = await post('recuperar-clave','123456',{email:'nadie@test.test'});
  const c = await post('recuperar-clave','123456',{email:'invalido'});
  assert.equal(a.status,200); assert.deepEqual(a.body,b.body); assert.deepEqual(a.body,c.body);
  assert.equal(a.headers['retry-after'],'60');
  assert.equal(b.headers['retry-after'],'60');
  assert.equal(mails.length,0);
  assert.deepEqual(await codeRow(),current);
});

test('reenvio invalida el anterior, mantiene bcrypt y vence en diez minutos',async()=>{
  await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '61 seconds'");
  assert.equal((await post('recuperar-clave')).status,200);
  assert.equal(mails.length,1);
  const code = mails[0][2].codigo;
  assert.match(code,/^\d{6}$/);
  const row = await codeRow();
  assert.equal(await bcrypt.compare(code,row.codigo_hash),true);
  assert.ok(Math.abs((new Date(row.expires_at)-new Date(row.creado_en))/1000-600)<1);
  assert.equal((await db.query('SELECT usado FROM password_reset_codes ORDER BY id')).rows[0].usado,true);
  // El codigo anterior se rechaza salvo coincidencia criptografica de seis digitos.
  if (code !== '123456') assert.equal((await post('login-con-codigo')).status,401);
  assert.equal((await post('login-con-codigo',code)).status,200);
});

test('emisiones simultaneas no eluden cooldown ni dejan dos codigos activos',async()=>{
  await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '61 seconds'");
  const responses = await concurrent(()=>post('recuperar-clave').then(r=>r),()=>post('recuperar-clave').then(r=>r),
    sql=>/FROM usuarios/.test(sql) && /FOR UPDATE/.test(sql));
  assert.ok(responses.every(r=>r.status===200));
  assert.equal(mails.length,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM password_reset_codes WHERE usado=false')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM password_reset_codes')).rows[0].n,2);
});

test('maximo tres emisiones por cuenta en quince minutos, incluso ya consumidas',async()=>{
  await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '3 minutes'");
  for (let i=0;i<2;i++) {
    await post('recuperar-clave');
    await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '2 minutes' WHERE usado=false");
  }
  assert.equal(mails.length,2);
  const before = await db.query('SELECT * FROM password_reset_codes ORDER BY id');
  await post('recuperar-clave');
  assert.equal(mails.length,2);
  assert.deepEqual((await db.query('SELECT * FROM password_reset_codes ORDER BY id')).rows,before.rows);
  await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '16 minutes'");
  await post('recuperar-clave');
  assert.equal(mails.length,3);
});

for (const operation of ['login-con-codigo','restablecer-clave']) test(`fallo SQL en ${operation} revierte consumo y efectos`,async()=>{
  const before = await state(); const beforeCode = await codeRow();
  const table = operation === 'login-con-codigo' ? 'refresh_sessions' : 'usuarios';
  const event = operation === 'login-con-codigo' ? 'INSERT' : 'UPDATE';
  await db.exec(`CREATE FUNCTION fail_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fallo inyectado'; END $$;
    CREATE TRIGGER recovery_failure AFTER ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_recovery();`);
  try {
    const response = await post(operation);
    assert.equal(response.status,500);
    assert.equal(response.headers['set-cookie'],undefined);
    assert.deepEqual(await state(),before);
    assert.deepEqual(await codeRow(),beforeCode);
    assert.equal(mails.length,0);
  } finally { await db.exec(`DROP TRIGGER recovery_failure ON ${table}; DROP FUNCTION fail_recovery();`); }
});

test('fallo al eliminar sesiones revierte password, version y consumo',async()=>{
  const before = await state(); const beforeCode = await codeRow();
  await db.exec(`CREATE FUNCTION fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fallo inyectado'; END $$;
    CREATE TRIGGER recovery_failure AFTER DELETE ON refresh_sessions FOR EACH ROW EXECUTE FUNCTION fail_delete();`);
  try {
    assert.equal((await post('restablecer-clave')).status,500);
    assert.deepEqual(await state(),before); assert.deepEqual(await codeRow(),beforeCode);
  } finally { await db.exec('DROP TRIGGER recovery_failure ON refresh_sessions; DROP FUNCTION fail_delete();'); }
});

test('no responde ni emite cookies antes del commit de la sesion',async()=>{
  let finished = false;
  const gate = gateAt(sql=>sql==='COMMIT');
  const response = post('login-con-codigo').then(r=>{ finished=true; return r; });
  await gate.ready.promise;
  assert.equal(finished,false);
  gate.release.resolve();
  assert.equal((await response).status,200);
});

test('restablecimiento legitimo cambia password y version, revoca sesiones y permite login nuevo',async()=>{
  assert.equal((await post('restablecer-clave')).status,200);
  const { users,sessions } = await state();
  const user = users.find(u=>u.id===9);
  assert.equal(user.token_version,8); assert.equal(sessions.length,0);
  assert.equal(await bcrypt.compare('NuevaClave12!',user.contraseña),true);
  assert.equal((await post('login',undefined,{contraseña:'Anterior12!'})).status,401);
  assert.equal((await post('login',undefined,{contraseña:'NuevaClave12!'})).status,200);
  assert.equal((await post('restablecer-clave')).status,400);
});

test('migracion conserva historial e invalida legacy, con restricciones SQL ejecutables',async()=>{
  const isolated = new PGlite();
  try {
    await isolated.exec(`CREATE TABLE password_reset_codes(id serial PRIMARY KEY,id_usuario int,codigo_hash text,
      expires_at timestamptz,usado boolean DEFAULT false,creado_en timestamptz DEFAULT now());
      INSERT INTO password_reset_codes(id_usuario,codigo_hash,expires_at) VALUES(1,'hash-a','2099-01-01'),(1,'hash-b','2099-01-01');`);
    await isolated.exec(await readFile(new URL('../migrations/20261023020040_seg06_recovery_codes.sql',import.meta.url),'utf8'));
    const rows = (await isolated.query('SELECT * FROM password_reset_codes')).rows;
    assert.equal(rows.length,2); assert.ok(rows.every(r=>r.usado && r.failed_attempts===0));
    await assert.rejects(isolated.exec('UPDATE password_reset_codes SET failed_attempts=6'));
    await isolated.exec("INSERT INTO password_reset_codes(id_usuario,codigo_hash) VALUES(1,'hash-c')");
    await assert.rejects(isolated.exec("INSERT INTO password_reset_codes(id_usuario,codigo_hash) VALUES(1,'hash-d')"));
  } finally { await isolated.close(); }
});

test('la tercera emision concurrente respeta el maximo y es indistinguible de la limitada',async()=>{
  await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '2 minutes'");
  await post('recuperar-clave');
  await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '61 seconds' WHERE usado=false");
  const responses = await concurrent(()=>post('recuperar-clave').then(r=>r),()=>post('recuperar-clave').then(r=>r),
    sql=>/FROM usuarios/.test(sql) && /FOR UPDATE/.test(sql));
  assert.deepEqual(responses[0].body,responses[1].body);
  assert.equal(mails.length,2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM password_reset_codes')).rows[0].n,3);
});

test('fallo SQL al emitir revierte la invalidacion del codigo anterior',async()=>{
  await db.exec("UPDATE password_reset_codes SET creado_en=clock_timestamp()-interval '61 seconds'");
  const before = await codeRow();
  await db.exec(`CREATE FUNCTION fail_issue() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fallo inyectado'; END $$;
    CREATE TRIGGER recovery_failure AFTER INSERT ON password_reset_codes FOR EACH ROW EXECUTE FUNCTION fail_issue();`);
  try {
    assert.equal((await post('recuperar-clave')).status,500);
    assert.deepEqual(await codeRow(),before); assert.equal(mails.length,0);
  } finally { await db.exec('DROP TRIGGER recovery_failure ON password_reset_codes; DROP FUNCTION fail_issue();'); }
});

test('un fallo SQL al leer no se convierte en codigo invalido ni exito generico',async()=>{
  await db.exec('ALTER TABLE password_reset_codes RENAME TO unavailable_reset_codes');
  try {
    for (const endpoint of ['recuperar-clave','login-con-codigo','restablecer-clave']) {
      assert.equal((await post(endpoint)).status,500);
    }
  } finally { await db.exec('ALTER TABLE unavailable_reset_codes RENAME TO password_reset_codes'); }
});

test('login por codigo conserva datos de rol y garages, y su refresh funciona',async()=>{
  await db.exec(`INSERT INTO roles VALUES(3,'garagista'); UPDATE usuarios SET id_rol=3 WHERE id=9;
    INSERT INTO usuario_garage VALUES(9,10),(9,20);`);
  const response = await post('login-con-codigo');
  assert.equal(response.status,200,response.text);
  assert.deepEqual(response.body.usuario.id_garages,[10,20]);
  assert.equal(response.body.usuario.tipo_rol,'garagista');
  const sessionCookie = response.headers['set-cookie'].find(c=>c.startsWith('refresh_session_id=')).split(';')[0];
  const refreshed = await request(app).post('/api/usuario/refresh').set('Cookie',sessionCookie).send({});
  assert.equal(refreshed.status,200,refreshed.text);
});

test('el limite adicional por IP responde 429 con Retry-After valido',async()=>{
  let response;
  for (let i=0;i<101;i++) response = await request(app).post('/api/usuario/recuperar-clave')
    .set('X-Forwarded-For','198.19.0.1').send({email:'inexistente@test.test'});
  assert.equal(response.status,429);
  assert.match(response.headers['retry-after'],/^\d+$/);
  assert.ok(Number(response.headers['retry-after'])>0);
});

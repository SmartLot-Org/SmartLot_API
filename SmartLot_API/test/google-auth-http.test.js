import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.NODE_ENV = 'test';
const token = randomBytes(32).toString('hex');
const userId = randomUUID();
const local = { id: 9, email: 'ana@example.test', activo: true, Borrado: false,
  id_rol: 2, id_empresa: 10, id_sede: 101, token_version: 7, contraseña: '<test-hash>' };
const identity = () => ({ id: 'google-subject-100', identity_id: randomUUID(), user_id: userId,
  provider: 'google', identity_data: { sub: 'google-subject-100', email: local.email, email_verified: true } });
const verifiedUser = () => ({ id: userId, email: local.email, email_confirmed_at: '2026-10-01T12:00:00Z',
  is_anonymous: false, identities: [identity()], app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: {} });
const state = { user: null, local: null, providerError: null, providerThrows: false,
  sessionFailure: null, providerCalls: [], lookups: [], sessionCalls: [], sessions: new Map() };
const getUser = async value => {
  state.providerCalls.push(value);
  if (state.providerThrows) throw new Error('INTERNAL-provider-detail');
  return { data: { user: state.user }, error: state.providerError };
};
const supabase = { auth: { getUser } };
mock.module('../src/services/supabaseAdminClient.js', { namedExports: { supabaseAdmin: supabase } });
mock.module('../src/database/db.js', { defaultExport: {
  query: async () => { throw new Error('Esta prueba no debe conectar a una base externa'); }
} });
mock.module('../src/services/emailService.js', { namedExports: {
  enviarCorreoDesdePlantilla: async () => { throw new Error('Esta prueba no debe enviar correo'); }
} });
mock.module('../src/repositories/usuarioRepository.js', { defaultExport: class {
  getByEmailAsync = async email => { state.lookups.push(email); return state.local; };
  getByIdAsync = async () => state.local;
  createSessionAsync = async (id, version, refreshToken, expiresAt) => {
    state.sessionCalls.push({ id, version, refreshToken, expiresAt });
    if (state.sessionFailure === 'throw') throw new Error('INTERNAL-session-detail');
    if (state.sessionFailure === 'null') return null;
    const sessionId = randomUUID();
    state.sessions.set(sessionId, { usuario_id: id, token_version: version, refresh_token: refreshToken, expires_at: expiresAt });
    return sessionId;
  };
  getSessionAsync = async id => state.sessions.get(id) ?? null;
  deleteSessionAsync = async id => { state.sessions.delete(id); };
} });
const { default: googleRouter } = await import('../src/controllers/AuthController.js');
const { default: userRouter } = await import('../src/controllers/usuarioController.js');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', googleRouter);
app.use('/api/usuario', userRouter);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
const callback = payload => request(app).post('/api/auth/google/callback')
  .set('Cookie', 'access_token=previous-cookie; refresh_session_id=existing-session')
  .send(payload ?? { access_token: token });
const generic = 'No se pudo iniciar sesión con Google.';
function noLogin(response, { lookup = false, sessionAttempt = false } = {}) {
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.body.access_token, undefined);
  assert.equal(response.body.usuario, undefined);
  assert.deepEqual(response.body, { message: generic });
  if (!lookup) assert.equal(state.lookups.length, 0);
  if (!sessionAttempt) assert.equal(state.sessionCalls.length, 0);
  assert.deepEqual([...state.sessions.keys()], ['existing-session']);
  assert.deepEqual(state.sessions.get('existing-session'), { unchanged: true });
}
test.beforeEach(() => {
  state.user = verifiedUser();
  state.local = { ...local };
  state.providerError = state.sessionFailure = null;
  state.providerThrows = false;
  state.providerCalls.length = state.lookups.length = state.sessionCalls.length = 0;
  state.sessions.clear();
  state.sessions.set('existing-session', { unchanged: true });
  supabase.auth = { getUser };
});

for (const [name, mutate] of [
  ['solo identidad email', u => { u.identities[0].provider = 'email'; }],
  ['email principal no confirmado', u => { delete u.email_confirmed_at; }],
  ['email solo en metadata editable', u => { delete u.email; u.user_metadata.email = local.email; }],
]) test(`SEG-09 regresión: ${name} no obtiene sesión`, async () => {
  mutate(state.user);
  const response = await callback();
  assert.equal(response.status, 401);
  noLogin(response);
});

test('Google verificado conserva respuesta local, JWT, cookies y refresh real', async () => {
  const response = await callback();
  assert.equal(response.status, 200);
  const { contraseña, ...publicLocal } = local;
  assert.deepEqual(response.body.usuario, publicLocal);
  assert.equal(response.body.token_type, 'Bearer');
  assert.equal(response.body.expires_in, '15m');
  assert.deepEqual(state.providerCalls, [token]);
  assert.deepEqual(state.lookups, [local.email]);
  const claims = jwt.verify(response.body.access_token, process.env.JWT_SECRET);
  for (const field of ['id', 'email', 'id_rol', 'id_empresa', 'id_sede', 'token_version']) assert.equal(claims[field], local[field]);
  const cookies = response.headers['set-cookie'];
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) assert.match(cookie, /HttpOnly; SameSite=Lax/);
  assert.match(cookies.find(c => c.startsWith('access_token=')), /Max-Age=900; Path=\//);
  const refreshCookie = cookies.find(c => c.startsWith('refresh_session_id='));
  assert.match(refreshCookie, /Max-Age=2592000; Path=\/api\/usuario\/refresh/);
  const firstId = refreshCookie.split(';')[0].split('=')[1];
  assert.equal(jwt.verify(state.sessions.get(firstId).refresh_token, process.env.JWT_REFRESH_SECRET).type, 'refresh');
  const refreshed = await request(app).post('/api/usuario/refresh').set('Cookie', `refresh_session_id=${firstId}`);
  assert.equal(refreshed.status, 200);
  assert.equal(jwt.verify(refreshed.body.access_token, process.env.JWT_SECRET).id, local.id);
  assert.equal(refreshed.headers['set-cookie'].length, 2);
  assert.equal(state.sessions.has(firstId), false);
  assert.deepEqual(state.sessions.get('existing-session'), { unchanged: true });
});

test('proveedor inicial email con Google vinculado es válido; metadata editable no elige cuenta ni rol', async () => {
  state.user.app_metadata = { provider: 'email', providers: ['email', 'google'] };
  state.user.identities.unshift({ ...identity(), id: userId, provider: 'email' });
  state.user.user_metadata = { email: 'victim@example.test', provider: 'google', email_verified: true, id_rol: 4, id_empresa: 99 };
  const response = await callback({ access_token: token, email: 'victim@example.test', id_rol: 4, id_empresa: 99 });
  assert.equal(response.status, 200);
  assert.deepEqual(state.lookups, [local.email]);
  assert.equal(response.body.usuario.id_rol, 2);
  assert.equal(jwt.verify(response.body.access_token, process.env.JWT_SECRET).id_empresa, 10);
});

for (const [name, mutate] of [
  ['otro proveedor', u => { u.identities[0].provider = 'github'; }],
  ['providers no sustituye identidad', u => { u.identities = []; u.app_metadata.providers = ['google']; }],
  ['anónimo', u => { u.is_anonymous = true; }],
  ['anónimo mal formado', u => { u.is_anonymous = 'false'; }],
  ['identidades ausentes', u => { delete u.identities; }],
  ['identidades objeto', u => { u.identities = {}; }],
  ['identidad null', u => { u.identities = [null]; }],
  ['usuario sin ID', u => { delete u.id; }],
  ['datos identidad ausentes', u => { delete u.identities[0].identity_data; }],
  ['datos identidad array', u => { u.identities[0].identity_data = []; }],
  ['vinculada a otro usuario', u => { u.identities[0].user_id = randomUUID(); }],
  ['subject contradictorio', u => { u.identities[0].identity_data.sub = 'other-subject'; }],
  ['subject ausente', u => { delete u.identities[0].identity_data.sub; }],
  ['ID identidad ausente', u => { delete u.identities[0].identity_id; }],
  ['provider_id contradictorio', u => { u.identities[0].provider_id = 'other-subject'; }],
  ['email contradictorio', u => { u.identities[0].identity_data.email = 'victim@example.test'; }],
  ['alias no equivalente', u => { u.identities[0].identity_data.email = 'ana+alias@example.test'; }],
  ['email generado contradictorio', u => { u.identities[0].email = 'victim@example.test'; }],
  ['confirmación inválida', u => { u.email_confirmed_at = 'not-a-date'; }],
  ['confirmación calendario imposible', u => { u.email_confirmed_at = '2026-02-30T12:00:00Z'; }],
  ['confirmación solo de teléfono', u => { delete u.email_confirmed_at; u.confirmed_at = u.phone_confirmed_at = '2026-10-01T12:00:00Z'; }],
  ['email principal objeto', u => { u.email = { email: local.email }; }],
  ['email principal inválido', u => { u.email = 'ana'; }],
  ...[undefined, false, 'true', 1, null].map(value => [`email_verified=${String(value)}`, u => { u.identities[0].identity_data.email_verified = value; }]),
  ['metadata no verifica identidad', u => { delete u.identities[0].identity_data.email_verified; u.user_metadata.email_verified = true; }],
  ['segunda identidad Google contradictoria', u => { u.identities.push({ ...identity(), identity_data: { sub: 'google-subject-100', email: 'victim@example.test', email_verified: true } }); }],
]) test(`identidad inválida: ${name}`, async () => {
  mutate(state.user);
  const response = await callback();
  assert.equal(response.status, 401);
  noLogin(response);
});

test('normaliza solo espacios externos y mayúsculas de emails', async () => {
  state.user.email = ' ANA@EXAMPLE.TEST ';
  state.user.identities[0].identity_data.email = 'Ana@example.test';
  const response = await callback();
  assert.equal(response.status, 200);
  assert.deepEqual(state.lookups, [local.email]);
});

for (const value of [undefined, null, '', '  ', [], {}, 10, true]) {
  test(`token inválido ${JSON.stringify(value)} no llama al proveedor`, async () => {
    const response = await callback({ access_token: value });
    assert.equal(response.status, 400);
    assert.equal(state.providerCalls.length, 0);
    noLogin(response);
  });
}

for (const code of ['bad_jwt', 'session_expired']) test(`Supabase rechaza token: ${code}`, async () => {
  state.providerError = { status: 401, code, message: 'INTERNAL-provider-detail' };
  const response = await callback();
  assert.equal(response.status, 401);
  noLogin(response);
});

for (const failure of ['throws', 'unavailable', 'server-error']) test(`fallo Supabase ${failure} no abre sesión`, async () => {
  if (failure === 'throws') state.providerThrows = true;
  if (failure === 'unavailable') supabase.auth = undefined;
  if (failure === 'server-error') state.providerError = { status: 503, message: 'INTERNAL-provider-detail' };
  const response = await callback();
  assert.equal(response.status, 503);
  noLogin(response);
});

for (const [name, value, status] of [['inexistente', null, 401], ['inactiva', { ...local, activo: false }, 403],
  ['borrada', { ...local, Borrado: true }, 403]]) test(`cuenta local ${name}`, async () => {
  state.local = value;
  const response = await callback();
  assert.equal(response.status, status);
  noLogin(response, { lookup: true });
});

for (const failure of ['throw', 'null']) test(`persistir sesión ${failure} no produce éxito ni cookies`, async () => {
  state.sessionFailure = failure;
  const response = await callback();
  assert.equal(response.status, 500);
  noLogin(response, { lookup: true, sessionAttempt: true });
});

test('respuesta Supabase sin usuario autenticado no busca cuenta local', async () => {
  state.user = null;
  const response = await callback();
  assert.equal(response.status, 401);
  noLogin(response);
});

for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) test(`configuración ${key} ausente no persiste sesión`, async () => {
  const previous = process.env[key];
  try {
    delete process.env[key];
    const response = await callback();
    assert.equal(response.status, 500);
    noLogin(response, { lookup: true });
  } finally { process.env[key] = previous; }
});

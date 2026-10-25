import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'api-errores-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'api-errores-refresh-secret';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

// Cada test decide qué responde la base para las consultas que no son del authMiddleware.
let queries = [];
let onQuery = async () => ({ rows: [], rowCount: 0 });
const usuarioAuth = { id_rol: 4, id_empresa: null, id_sede: null, tipo_rol: 'superadmin', id_garage: null, id_garages: [] };
let authFails = false;
let authRows = [usuarioAuth];

mock.module('../src/database/db.js', { defaultExport: {
    query: async (sql, params) => {
        queries.push(sql);
        if (sql.includes('COALESCE(u.activo, true) = true')) {
            if (authFails) throw new Error('conexion perdida');
            return { rows: authRows, rowCount: authRows.length };
        }
        return onQuery(sql, params);
    },
} });

// emailService abre su propio pool contra la base real al importarse: se reemplaza para no salir de la máquina.
mock.module('../src/services/emailService.js', { namedExports: {
    enviarCorreoDesdePlantilla: async () => {},
    enviarCorreo: async () => {},
    renderPlantilla: async () => '',
    invalidarCachePlantilla: () => {},
} });

const { default: app } = await import('../src/app.js');
const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
const autenticado = (req) => req.set('Authorization', `Bearer ${token}`);

const pgError = (code) => Object.assign(new Error(`detalle interno ${code}: tabla "marcas", columna "nombre"`), { code });
const borraSesion = (res) => (res.headers['set-cookie'] ?? []).some(c => /^(access_token|refresh_session_id)=;/.test(c));

test.beforeEach(() => {
    queries = [];
    authFails = false;
    authRows = [usuarioAuth];
    onQuery = async () => ({ rows: [], rowCount: 0 });
    mock.method(console, 'error', () => {});
    mock.method(console, 'warn', () => {});
});
test.afterEach(() => mock.restoreAll());

test('falla de la base en un GET por id responde 500, no 404, y no toca la sesión', async () => {
    onQuery = async () => { throw new Error('conexion perdida'); };
    const res = await autenticado(request(app).get('/api/marca/1'));
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: true, message: 'Error interno del servidor', statusCode: 500 });
    assert.equal(borraSesion(res), false);
    assert.equal(res.headers['set-cookie'], undefined);
});

test('fila inexistente sigue siendo 404 (no encontrado es un resultado, no una excepción)', async () => {
    const res = await autenticado(request(app).get('/api/marca/1'));
    assert.equal(res.status, 404);
    assert.equal(res.headers['set-cookie'], undefined);
});

test('falla de la base en un listado responde 500 sin vaciar la lista ni borrar cookies', async () => {
    onQuery = async () => { throw new Error('conexion perdida'); };
    const res = await autenticado(request(app).get('/api/marca'));
    assert.equal(res.status, 500);
    assert.equal(res.headers['set-cookie'], undefined);
});

test('listado vacío es 200 con arreglo vacío', async () => {
    const res = await autenticado(request(app).get('/api/marca'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
});

for (const [code, status, symbolic] of [
    ['23505', 409, 'DB_UNIQUE_VIOLATION'],
    ['23503', 409, 'DB_FOREIGN_KEY_VIOLATION'],
    ['23502', 400, 'DB_NOT_NULL_VIOLATION'],
    ['23514', 400, 'DB_CHECK_VIOLATION'],
    ['22P02', 400, 'DB_INVALID_FORMAT'],
    ['22001', 400, 'DB_VALUE_TOO_LONG'],
]) {
    test(`error de Postgres ${code} se traduce a ${status} sin exponer el detalle del driver`, async () => {
        onQuery = async () => { throw pgError(code); };
        const res = await autenticado(request(app).post('/api/marca')).send({ nombre: 'Fiat' });
        assert.equal(res.status, status);
        assert.equal(res.body.code, symbolic);
        assert.equal(res.body.statusCode, status);
        assert.doesNotMatch(JSON.stringify(res.body), /marcas|columna|detalle interno/);
        assert.equal(res.headers['set-cookie'], undefined);
    });
}

test('un error de Postgres no mapeado sigue siendo 500 genérico', async () => {
    onQuery = async () => { throw pgError('42P01'); };
    const res = await autenticado(request(app).get('/api/marca/1'));
    assert.equal(res.status, 500);
    assert.equal(res.body.message, 'Error interno del servidor');
});

test('un error de dominio con statusCode no se reinterpreta aunque traiga un código de Postgres', async () => {
    onQuery = async () => { throw Object.assign(new Error('Ya existe una marca con ese nombre.'), { code: '23505', statusCode: 422 }); };
    const res = await autenticado(request(app).post('/api/marca')).send({ nombre: 'Fiat' });
    assert.equal(res.status, 422);
    assert.equal(res.body.message, 'Ya existe una marca con ese nombre.');
});

test('PATCH de una notificación inexistente responde 404 y la sesión sigue viva', async () => {
    const res = await autenticado(request(app).patch('/api/notificacion/999/leer'));
    assert.equal(res.status, 404);
    assert.equal(res.body.message, 'Notificación no encontrada o no pertenece al usuario.');
    assert.equal(borraSesion(res), false);
    const me = await autenticado(request(app).get('/api/usuario/me'));
    assert.equal(me.status, 200);
});

test('DELETE de una notificación inexistente responde 404', async () => {
    const res = await autenticado(request(app).delete('/api/notificacion/999'));
    assert.equal(res.status, 404);
    assert.equal(borraSesion(res), false);
});

test('base caída en authMiddleware responde 500, no 401, y conserva las cookies', async () => {
    authFails = true;
    const res = await autenticado(request(app).get('/api/marca'));
    assert.equal(res.status, 500);
    assert.equal(res.body.message, 'Error interno del servidor');
    assert.equal(res.headers['set-cookie'], undefined);
});

test('base caída en authMiddleware de pagos (wrapper del webhook) también responde 500', async () => {
    authFails = true;
    const res = await autenticado(request(app).get('/api/payments/123'));
    assert.equal(res.status, 500);
    assert.equal(res.headers['set-cookie'], undefined);
});

test('JWT inválido sigue siendo 401 y limpia las cookies de sesión', async () => {
    const res = await request(app).get('/api/marca').set('Authorization', 'Bearer no-es-un-jwt');
    assert.equal(res.status, 401);
    assert.equal(res.body.message, 'Token invalido o expirado.');
    assert.equal(borraSesion(res), true);
});

test('usuario inexistente o inactivo sigue siendo 401', async () => {
    authRows = [];
    const res = await autenticado(request(app).get('/api/marca'));
    assert.equal(res.status, 401);
    assert.equal(res.body.message, 'El usuario no existe o esta inactivo.');
});

test('sin token responde 401', async () => {
    const res = await request(app).get('/api/marca');
    assert.equal(res.status, 401);
    assert.equal(res.body.message, 'Falta el token de autenticacion.');
});

test('origen CORS no permitido responde 403 con mensaje en español', async () => {
    const res = await request(app).get('/api/marca').set('Origin', 'https://intruso.example');
    assert.equal(res.status, 403);
    assert.equal(res.body.message, 'Origen no permitido.');
});

test('origen CORS permitido no se bloquea', async () => {
    const res = await autenticado(request(app).get('/api/marca')).set('Origin', 'http://localhost:5173');
    assert.equal(res.status, 200);
});

test('refresh con cookie de sesión mal formada responde 401 sin consultar la base y la descarta', async () => {
    const res = await request(app).post('/api/usuario/refresh').set('Cookie', 'refresh_session_id=no-es-un-uuid');
    assert.equal(res.status, 401);
    assert.equal(queries.length, 0);
    assert.equal(borraSesion(res), true);
});

test('refresh con sesión inexistente responde 401 y la descarta', async () => {
    const res = await request(app).post('/api/usuario/refresh').set('Cookie', `refresh_session_id=${randomUUID()}`);
    assert.equal(res.status, 401);
    assert.equal(borraSesion(res), true);
});

test('refresh con la base caída responde 500 y NO desloguea al usuario', async () => {
    onQuery = async () => { throw new Error('conexion perdida'); };
    const res = await request(app).post('/api/usuario/refresh').set('Cookie', `refresh_session_id=${randomUUID()}`);
    assert.equal(res.status, 500);
    assert.equal(res.body.message, 'Error interno del servidor');
    assert.equal(borraSesion(res), false);
});

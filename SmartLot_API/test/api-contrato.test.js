import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'api-contrato-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'api-contrato-refresh-secret';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

// El rol del usuario autenticado se cambia por test; por defecto es superadmin.
const roles = {
    superadmin: { id_rol: 4, id_empresa: null, id_sede: null, tipo_rol: 'superadmin', id_garage: null, id_garages: [] },
    admin: { id_rol: 1, id_empresa: 10, id_sede: null, tipo_rol: 'admin', id_garage: null, id_garages: [] },
};
let actor = roles.superadmin;
let queries = [];
let onQuery = async () => ({ rows: [], rowCount: 0 });

const run = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('COALESCE(u.activo, true) = true')) return { rows: [actor], rowCount: 1 };
    return onQuery(sql, params);
};
mock.module('../src/database/db.js', { defaultExport: { query: run, connect: async () => ({ query: run, release() {} }) } });
mock.module('../src/services/emailService.js', { namedExports: {
    enviarCorreoDesdePlantilla: async () => {},
    enviarCorreo: async () => {},
    renderPlantilla: async () => '',
    invalidarCachePlantilla: () => {},
} });

const { default: app } = await import('../src/app.js');
const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
const as = (req) => req.set('Authorization', `Bearer ${token}`);
const delNegocio = () => queries.filter(q => !(q.sql.includes('COALESCE(u.activo, true) = true')));

test.beforeEach(() => {
    queries = [];
    actor = roles.superadmin;
    onQuery = async () => ({ rows: [], rowCount: 0 });
    mock.method(console, 'error', () => {});
    mock.method(console, 'warn', () => {});
});
test.afterEach(() => mock.restoreAll());

// ─── Rutas inexistentes y endpoints retirados ───────────────────────────────

test('una ruta inexistente responde 404 con el formato de error común, no con HTML', async () => {
    const res = await as(request(app).get('/api/no-existe'));
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /json/);
    assert.deepEqual(res.body, { error: true, message: 'Ruta no encontrada.', statusCode: 404 });
});

test('GET /api/garage/:id/cercanos se retiró: la ruta vigente es /api/garage/cercanos', async () => {
    const retirada = await as(request(app).get('/api/garage/5/cercanos'));
    assert.equal(retirada.status, 404);
    assert.equal(retirada.body.message, 'Ruta no encontrada.');
    // La ruta vigente valida su entrada en lugar de caer en :id.
    const vigente = await as(request(app).get('/api/garage/cercanos'));
    assert.equal(vigente.status, 400);
    assert.match(vigente.body.message, /sede_id/);
});

test('DELETE /api/trato-empresa-garage/:id se retiró: cancelar es PATCH /:id/cancelar', async () => {
    const res = await as(request(app).delete('/api/trato-empresa-garage/5'));
    assert.equal(res.status, 404);
    assert.equal(res.body.message, 'Ruta no encontrada.');
});

test('la ruta de contraseña es una sola y ASCII: los alias con ñ ya no existen', async () => {
    for (const path of ['/api/usuario/7/contraseña', '/api/usuario/7/contrase%C3%B1a']) {
        const res = await as(request(app).patch(path)).send({ contraseña: 'Segura12!!' });
        assert.equal(res.status, 404, path);
        assert.equal(res.body.message, 'Ruta no encontrada.');
    }
    assert.equal(delNegocio().length, 0);
    const vigente = await as(request(app).patch('/api/usuario/7/contrasenia')).send({ contraseña: 'débil' });
    assert.equal(vigente.status, 400);
});

// ─── Un recurso, una entidad ────────────────────────────────────────────────

test('POST /api/trato-empresa-garage es solo del superadmin: el admin propone con una solicitud', async () => {
    actor = roles.admin;
    const res = await as(request(app).post('/api/trato-empresa-garage')).send({ id_sede: 1, id_garage: 2, cantidad_cocheras: 3 });
    assert.equal(res.status, 403);
    assert.equal(delNegocio().length, 0);
});

test('POST /api/trato-empresa-garage del superadmin crea un trato, nunca una solicitud', async () => {
    onQuery = async () => ({ rows: [], rowCount: 0 });
    const res = await as(request(app).post('/api/trato-empresa-garage')).send({ id_sede: 1, id_garage: 2, cantidad_cocheras: 3 });
    // Llega al service de tratos (que valida contra la base simulada); no a SolicitudEmpresaGarage.
    assert.notEqual(res.status, 403);
    assert.equal(queries.some(q => /solicitudes/i.test(q.sql) && /INSERT/i.test(q.sql)), false);
});

// ─── Sin doble autenticación ────────────────────────────────────────────────

test('reservas y notificaciones siguen exigiendo sesión (la aplica app.js, no cada ruta)', async () => {
    for (const [method, path] of [
        ['post', '/api/reserva'], ['put', '/api/reserva/5'], ['delete', '/api/reserva/5'], ['post', '/api/reserva/5/cancel'],
        ['post', '/api/reserva/5/liberar-retencion'], ['post', '/api/reserva/5/check-in'], ['post', '/api/reserva/5/check-out'],
        ['get', '/api/notificacion'], ['get', '/api/notificacion/no-leidas/count'], ['patch', '/api/notificacion/5/leer'],
        ['patch', '/api/notificacion/leer-todas'], ['delete', '/api/notificacion/5'],
    ]) {
        const res = await request(app)[method](path).send({});
        assert.equal(res.status, 401, `${method} ${path}`);
    }
    assert.equal(delNegocio().length, 0);
});

test('el authMiddleware corre una sola vez por pedido en rutas de reserva y notificación', async () => {
    await as(request(app).get('/api/notificacion'));
    const consultasDeAuth = queries.filter(q => q.sql.includes('COALESCE(u.activo, true) = true'));
    assert.equal(consultasDeAuth.length, 1);
});

// ─── Status puntuales ───────────────────────────────────────────────────────

const respondeGarage = (diaNuevo) => async (sql) => {
    if (/FROM garages/i.test(sql)) return { rows: [{ id: 5 }], rowCount: 1 };
    if (/INSERT INTO garage_dias/i.test(sql)) return diaNuevo ? { rows: [{ id_garage: 5, dia: 'Lunes', activo: true }], rowCount: 1 } : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
};

test('agregar un día nuevo a un garage responde 201', async () => {
    onQuery = respondeGarage(true);
    const res = await as(request(app).post('/api/garage/5/dias')).send({ dia: 'Lunes' });
    assert.equal(res.status, 201);
});

test('agregar un día que el garage ya tiene activo responde 409, no 400', async () => {
    onQuery = respondeGarage(false);
    const res = await as(request(app).post('/api/garage/5/dias')).send({ dia: 'Lunes' });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /ya estaba registrado/);
    // Solo se reactiva un día inactivo: reponer uno activo no es una escritura.
    assert.match(queries.find(q => /INSERT INTO garage_dias/.test(q.sql)).sql, /WHERE garage_dias\.activo = false/);
});

test('agregar un día a un garage inexistente sigue siendo 404', async () => {
    onQuery = async () => ({ rows: [], rowCount: 0 });
    const res = await as(request(app).post('/api/garage/5/dias')).send({ dia: 'Lunes' });
    assert.equal(res.status, 404);
});

test('liberar la retención de una reserva inexistente es 404, nunca el viejo 500 de la rama muerta', async () => {
    actor = roles.superadmin;
    const res = await as(request(app).post('/api/reserva/5/liberar-retencion'));
    assert.equal(res.status, 404);
});

// ─── Contrato de usuario ────────────────────────────────────────────────────

test('el listado de usuarios expone limiteReservasActivas una sola vez y nunca el hash', async () => {
    onQuery = async () => ({ rows: [{ id: 7, nombre: 'Ana', contraseña: 'hash-secreto', limite_reservas_activas: 3 }], rowCount: 1 });
    const res = await as(request(app).get('/api/usuario'));
    assert.equal(res.status, 200);
    assert.equal(res.body[0].limiteReservasActivas, 3);
    assert.equal(Object.hasOwn(res.body[0], 'limite_reservas_activas'), false);
    assert.equal(Object.hasOwn(res.body[0], 'contraseña'), false);
});

test('un usuario sin límite informa limiteReservasActivas null', async () => {
    onQuery = async () => ({ rows: [{ id: 7, nombre: 'Ana', limite_reservas_activas: null }], rowCount: 1 });
    const res = await as(request(app).get('/api/usuario'));
    assert.equal(res.body[0].limiteReservasActivas, null);
});

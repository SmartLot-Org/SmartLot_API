import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'api-validacion-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'api-validacion-refresh-secret';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

// Cada test decide qué responde la base; el authMiddleware siempre ve a un superadmin.
const superadmin = { id_rol: 4, id_empresa: null, id_sede: null, tipo_rol: 'superadmin', id_garage: null, id_garages: [] };
let queries = [];
let onQuery = async () => ({ rows: [], rowCount: 0 });

const run = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('COALESCE(u.activo, true) = true')) return { rows: [superadmin], rowCount: 1 };
    return onQuery(sql, params);
};
mock.module('../src/database/db.js', { defaultExport: {
    query: run,
    connect: async () => ({ query: run, release() {} }),
} });
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
const ejecuto = (patron) => queries.some(q => patron.test(q.sql));

test.beforeEach(() => {
    queries = [];
    onQuery = async () => ({ rows: [], rowCount: 0 });
    mock.method(console, 'error', () => {});
    mock.method(console, 'warn', () => {});
});
test.afterEach(() => mock.restoreAll());

// ─── PUT = reemplazo completo ────────────────────────────────────────────────

test('PUT marca con cuerpo vacío responde 400 (antes 404) y no ejecuta el UPDATE', async () => {
    const res = await as(request(app).put('/api/marca/5')).send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.message, 'El nombre es requerido.');
    assert.equal(ejecuto(/UPDATE marcas/), false);
});

test('PUT marca sin cuerpo ni content-type responde 400, no 500 por un TypeError', async () => {
    const res = await as(request(app).put('/api/marca/5'));
    assert.equal(res.status, 400);
});

test('PUT marca con nombre en blanco responde 400', async () => {
    const res = await as(request(app).put('/api/marca/5')).send({ nombre: '   ' });
    assert.equal(res.status, 400);
});

test('PUT marca completo actualiza y devuelve la fila', async () => {
    onQuery = async (sql) => sql.includes('UPDATE marcas') ? { rows: [{ id: 5, nombre: 'Fiat' }], rowCount: 1 } : { rows: [] };
    const res = await as(request(app).put('/api/marca/5')).send({ nombre: 'Fiat' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: 5, nombre: 'Fiat' });
    assert.deepEqual(queries.find(q => /UPDATE marcas/.test(q.sql)).params, ['Fiat', 5]);
});

test('PUT marca completo sobre una marca inexistente responde 404', async () => {
    const res = await as(request(app).put('/api/marca/5')).send({ nombre: 'Fiat' });
    assert.equal(res.status, 404);
});

test('PUT modelo exige nombre e id_marca', async () => {
    assert.equal((await as(request(app).put('/api/modelo/5')).send({ nombre: 'Uno' })).status, 400);
    assert.equal((await as(request(app).put('/api/modelo/5')).send({ id_marca: 1 })).status, 400);
    assert.equal((await as(request(app).put('/api/modelo/5')).send({ nombre: 'Uno', id_marca: 'x' })).status, 400);
    assert.equal(ejecuto(/UPDATE modelos/), false);
});

test('PUT modelo completo llega al UPDATE con ambos campos', async () => {
    onQuery = async (sql) => {
        if (sql.includes('FROM marcas')) return { rows: [{ id: 1 }] };
        if (sql.includes('UPDATE modelos')) return { rows: [{ id: 5, id_marca: 1, nombre: 'Uno' }] };
        return { rows: [] };
    };
    const res = await as(request(app).put('/api/modelo/5')).send({ nombre: 'Uno', id_marca: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(queries.find(q => /UPDATE modelos/.test(q.sql)).params, [1, 'Uno', 5]);
});

test('PUT rol exige tipo_rol', async () => {
    assert.equal((await as(request(app).put('/api/rol/5')).send({})).status, 400);
    assert.equal(ejecuto(/UPDATE roles/), false);
});

test('PUT empresa exige nombre y descripción explícita (texto o null)', async () => {
    assert.equal((await as(request(app).put('/api/empresa/3')).send({})).status, 400);
    assert.equal((await as(request(app).put('/api/empresa/3')).send({ nombre: 'Acme' })).status, 400);
    assert.equal((await as(request(app).put('/api/empresa/3')).send({ nombre: 'Acme', descripcion: 7 })).status, 400);
    assert.equal(ejecuto(/UPDATE empresas/), false);
});

test('PUT empresa acepta descripcion null y la envía como null', async () => {
    onQuery = async (sql) => sql.includes('UPDATE empresas') ? { rows: [{ id: 3 }], rowCount: 1 } : { rows: [] };
    const res = await as(request(app).put('/api/empresa/3')).send({ nombre: 'Acme', descripcion: null });
    assert.equal(res.status, 200);
    assert.deepEqual(queries.find(q => /UPDATE empresas/.test(q.sql)).params.slice(0, 2), ['Acme', null]);
});

test('PUT sede exige nombre y ubicación explícita (texto o null)', async () => {
    assert.equal((await as(request(app).put('/api/sede/5')).send({})).status, 400);
    assert.equal((await as(request(app).put('/api/sede/5')).send({ nombre: 'Centro' })).status, 400);
    assert.equal((await as(request(app).put('/api/sede/5')).send({ ubicacion: 'Calle 1' })).status, 400);
    assert.equal((await as(request(app).put('/api/sede/5')).send({ nombre: '', ubicacion: 'Calle 1' })).status, 400);
    assert.equal((await as(request(app).put('/api/sede/5')).send({ nombre: 'Centro', ubicacion: 'x', id_empresa: 'abc' })).status, 400);
    assert.equal(ejecuto(/UPDATE sedes/), false);
});

// ─── PATCH = parcial ─────────────────────────────────────────────────────────

const sedeActual = { id: 5, id_empresa: 3, nombre: 'Centro', descripcion: 'd', ubicacion: 'Calle 1', latitud: '-34.1', longitud: '-58.2' };
const respondeSede = () => async (sql) => {
    if (/SELECT \* FROM sedes/.test(sql)) return { rows: [sedeActual] };
    if (/UPDATE sedes/.test(sql)) return { rows: [{ ...sedeActual, nombre: 'Nuevo' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
};

test('PATCH sede con un solo campo actualiza solo ese campo y conserva empresa y coordenadas', async () => {
    onQuery = respondeSede();
    const res = await as(request(app).patch('/api/sede/5')).send({ nombre: 'Nuevo' });
    assert.equal(res.status, 200);
    const update = queries.find(q => /UPDATE sedes/.test(q.sql));
    assert.match(update.sql, /SET nombre=\$2\s+WHERE/);
    assert.doesNotMatch(update.sql, /id_empresa=|latitud=|longitud=|ubicacion=|descripcion=/);
    assert.deepEqual(update.params, [5, 'Nuevo']);
    assert.equal(res.body.id_empresa, 3);
    assert.equal(res.body.latitud, '-34.1');
});

test('PATCH sede sin ningún campo editable responde 400', async () => {
    onQuery = respondeSede();
    assert.equal((await as(request(app).patch('/api/sede/5')).send({})).status, 400);
    assert.equal((await as(request(app).patch('/api/sede/5')).send({ otro: 1 })).status, 400);
    assert.equal(ejecuto(/UPDATE sedes/), false);
});

test('PATCH sede valida los campos que sí llegan', async () => {
    assert.equal((await as(request(app).patch('/api/sede/5')).send({ nombre: '' })).status, 400);
    assert.equal((await as(request(app).patch('/api/sede/5')).send({ id_empresa: 'abc' })).status, 400);
});

test('PUT sede completo con ubicación null llega al UPDATE', async () => {
    onQuery = respondeSede();
    const res = await as(request(app).put('/api/sede/5')).send({ nombre: 'Nuevo', ubicacion: null });
    assert.equal(res.status, 200);
    const update = queries.find(q => /UPDATE sedes/.test(q.sql));
    assert.match(update.sql, /nombre=\$2,ubicacion=\$3/);
    assert.deepEqual(update.params, [5, 'Nuevo', null]);
});

// ─── :id validado igual en todos los routers ────────────────────────────────

const idsInvalidos = ['7abc', '0', '-1', '1.5', '1e3', '99999999999999999999'];
for (const id of idsInvalidos) {
    test(`GET /api/marca/${id} responde 400 sin consultar la base`, async () => {
        const res = await as(request(app).get(`/api/marca/${id}`));
        assert.equal(res.status, 400);
        assert.equal(res.body.message, 'El ID proporcionado no es válido.');
        assert.equal(delNegocio().length, 0);
    });
}

const rutasConId = [
    ['get', '/api/modelo/abc'], ['get', '/api/rol/0'], ['get', '/api/empresa/12x'], ['get', '/api/sede/x'],
    ['get', '/api/vehiculo/1e3'], ['delete', '/api/vehiculo/abc'], ['put', '/api/vehiculo/abc'],
    ['get', '/api/garage/abc'], ['get', '/api/garage/abc/dias'], ['post', '/api/garage/abc/dias'],
    ['get', '/api/garage/ocupacion_reserva/abc'], ['patch', '/api/garage/abc/restaurar'],
    ['get', '/api/reserva/abc'], ['put', '/api/reserva/abc'], ['post', '/api/reserva/abc/cancel'], ['get', '/api/reserva/abc/qr'],
    ['get', '/api/usuario/abc'], ['put', '/api/usuario/7abc'], ['delete', '/api/usuario/abc'],
    ['patch', '/api/usuario/7abc/contrasenia'], ['patch', '/api/usuario/7abc/estado'], ['patch', '/api/usuario/7abc/limite-reservas'],
    ['patch', '/api/notificacion/abc/leer'], ['delete', '/api/notificacion/abc'],
    ['get', '/api/conflicto/abc'], ['put', '/api/conflicto/abc'], ['delete', '/api/conflicto/abc'],
    ['get', '/api/trato-empresa-garage/abc'], ['put', '/api/trato-empresa-garage/abc'],
    ['patch', '/api/trato-empresa-garage/abc/cancelar'],
    ['patch', '/api/solicitud-empresa-garage/abc/aceptar'], ['get', '/api/solicitud-empresa-garage/abc'],
    ['get', '/api/solicitud-registro/abc'], ['patch', '/api/solicitud-registro/abc/aprobar'],
];
for (const [method, path] of rutasConId) {
    test(`${method.toUpperCase()} ${path} responde 400 por id inválido sin tocar la base`, async () => {
        const res = await as(request(app)[method](path)).send({});
        assert.equal(res.status, 400);
        assert.match(res.body.message, /proporcionado no es válido/);
        assert.equal(delNegocio().length, 0);
    });
}

test('los otros parámetros de ruta con id también se validan y nombran el recurso', async () => {
    const garage = await as(request(app).get('/api/reserva/control-acceso/abc'));
    assert.equal(garage.status, 400);
    assert.equal(garage.body.message, 'El ID de garage proporcionado no es válido.');
    const usuario = await as(request(app).get('/api/reserva/usuario/abc'));
    assert.equal(usuario.body.message, 'El ID de usuario proporcionado no es válido.');
    const trato = await as(request(app).get('/api/trato-empresa-garage/empresa/abc'));
    assert.equal(trato.body.message, 'El ID de empresa proporcionado no es válido.');
    const gar = await as(request(app).get('/api/usuario/garage/abc'));
    assert.equal(gar.body.message, 'El ID de garage proporcionado no es válido.');
    assert.equal(delNegocio().length, 0);
});

test('el id llega a la consulta como número', async () => {
    onQuery = async () => ({ rows: [{ id: 7, nombre: 'Fiat' }] });
    const res = await as(request(app).get('/api/marca/7'));
    assert.equal(res.status, 200);
    assert.deepEqual(queries.find(q => /FROM marcas/.test(q.sql)).params, [7]);
});

test('un id válido pero fuera del rango de la columna responde 400, no 500', async () => {
    onQuery = async () => { throw Object.assign(new Error('value "99999999999" is out of range for type integer'), { code: '22003' }); };
    const res = await as(request(app).get('/api/marca/99999999999'));
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'DB_VALUE_OUT_OF_RANGE');
});

test('rutas con parámetros que no son ids numéricos no se ven afectadas', async () => {
    const res = await as(request(app).get('/api/email-template/bienvenida'));
    assert.notEqual(res.status, 400);
});

test('PUT reserva ya no valida id_usuario: el titular se descarta en el service', async () => {
    onQuery = async (sql) => sql.includes('FROM reservas') ? { rows: [] } : { rows: [] };
    const res = await as(request(app).put('/api/reserva/5')).send({ id_usuario: 'abc', dia: 'Lunes' });
    // Llega al service (404 por reserva inexistente) en lugar de morir con un 400 por id_usuario.
    assert.equal(res.status, 404);
});

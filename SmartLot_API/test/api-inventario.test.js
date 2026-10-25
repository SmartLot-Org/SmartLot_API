import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_SECRET = 'api-inventario-jwt-secret';
process.env.NODE_ENV = 'test';

mock.module('../src/database/db.js', { defaultExport: {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
} });
mock.module('../src/services/emailService.js', { namedExports: {
    enviarCorreoDesdePlantilla: async () => {},
    enviarCorreo: async () => {},
    renderPlantilla: async () => '',
    invalidarCachePlantilla: () => {},
} });

const { collectRoutes, renderMarkdown, normalizeRoles, statusesOf, INVENTORY_START, INVENTORY_END } =
    await import('../scripts/api-inventory.mjs');

const routes = await collectRoutes();
const find = (method, path) => routes.find((route) => route.method === method && route.path === path);
const apiDoc = readFileSync(new URL('../docs/plans-franC/api.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('docs/plans-franC/api.md contiene el inventario vigente: se regenera con `npm run routes:inventory -- --write`', () => {
    const start = apiDoc.indexOf(INVENTORY_START);
    const end = apiDoc.indexOf(INVENTORY_END);
    assert.ok(start >= 0 && end > start, 'faltan los marcadores del inventario en docs/plans-franC/api.md');
    assert.equal(apiDoc.slice(start, end + INVENTORY_END.length), renderMarkdown(routes));
});

test('el inventario cubre todos los módulos montados y no repite endpoints', () => {
    const mounts = new Set(routes.map((route) => route.mount));
    for (const mount of ['/api/empresa', '/api/garage', '/api/marca', '/api/modelo', '/api/reserva', '/api/rol', '/api/sede',
        '/api/usuario', '/api/vehiculo', '/api/auth', '/api/conflicto', '/api/trato-empresa-garage',
        '/api/solicitud-empresa-garage', '/api/solicitud-registro', '/api/notificacion', '/api/payments',
        '/api/email-template', '/api/cuentas-corrientes']) {
        assert.ok(mounts.has(mount), mount);
    }
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    assert.equal(new Set(keys).size, keys.length, 'hay endpoints repetidos');
    assert.ok(routes.length > 130);
});

test('el inventario refleja el contrato vigente del plan "API REST"', () => {
    assert.deepEqual(normalizeRoles(find('PATCH', '/api/sede/:id').roles), [1, 4]);
    assert.deepEqual(normalizeRoles(find('POST', '/api/payments/:paymentId/verificar').roles), [1, 2, 4]);
    assert.deepEqual(normalizeRoles(find('POST', '/api/payments/verificar').roles), [1, 2, 4]);
    assert.deepEqual(normalizeRoles(find('POST', '/api/trato-empresa-garage').roles), [4]);
    assert.equal(find('PATCH', '/api/usuario/:id/contrasenia').allowsSelf, true);
    assert.equal(find('POST', '/api/payments/webhook').auth, false);
    assert.equal(find('POST', '/api/payments/preference').auth, true);
    assert.equal(find('POST', '/api/usuario/login').auth, false);
    assert.equal(find('GET', '/api/marca/:id').auth, true);
});

test('los endpoints retirados no figuran en el router', () => {
    for (const [method, path] of [
        ['GET', '/api/garage/:id/cercanos'],
        ['DELETE', '/api/trato-empresa-garage/:id'],
        ['PATCH', '/api/usuario/:id/contraseña'],
        ['PATCH', '/api/usuario/:id/contrase%C3%B1a'],
    ]) assert.equal(find(method, path), undefined, `${method} ${path}`);
});

test('los GET de pagos responden 200 y existen los POST de verificación (la pureza del GET la prueban payment-read-*)', () => {
    for (const route of routes.filter((item) => item.mount === '/api/payments' && item.method === 'GET')) {
        assert.ok(route.success.includes(200), route.path);
    }
    assert.ok(find('POST', '/api/payments/:paymentId/verificar'));
});

test('statusesOf lee los códigos literales y las constantes de httpStatus del handler', () => {
    const handler = async (req, res) => {
        if (!req.body.a) throwError('falta a', BAD_REQUEST);
        if (!req.body.b) throwError(`no existe ${req.body.b}, y mas`, 404);
        if (!req.body.c) throwError('ya existe', CONFLICT);
        res.status(201).json({ ok: true });
    };
    assert.deepEqual(statusesOf(String(handler)), { success: [201], errors: [400, 404, 409], dynamic: false });
    assert.deepEqual(statusesOf('res.json({})').success, [200]);
    assert.equal(statusesOf('res.status(result.httpStatus).json({})').dynamic, true);
});

const postmanRaw = readFileSync(new URL('../src/postman/SmartLot.postman_collection.json', import.meta.url), 'utf8');
const postman = JSON.parse(postmanRaw);

test('la colección Postman tiene una request por endpoint (se regenera con `npm run postman:generate`)', () => {
    const documented = new Set(postman.item
        .filter((folder) => !folder.name.startsWith('Casos de error'))
        .flatMap((folder) => folder.item.map((request) => request.name)));
    const expected = routes.map((route) => `${route.method} ${route.path.replace(/^\/api/, '')}`);
    assert.deepEqual(expected.filter((name) => !documented.has(name)), [], 'endpoints sin request en Postman');
    assert.deepEqual([...documented].filter((name) => !expected.includes(name)), [], 'requests de endpoints que ya no existen');
});

test('la colección Postman incluye los casos de error de las fases 1 a 3, cada uno con su test', () => {
    const errores = postman.item.find((folder) => folder.name.startsWith('Casos de error'));
    assert.ok(errores && errores.item.length >= 15);
    for (const request of errores.item) {
        assert.ok(request.event?.some((event) => event.listen === 'test'), `${request.name} sin test`);
    }
    assert.ok(errores.item.some((request) => request.name.startsWith('[400] PUT marca con cuerpo vacío')));
});

test('la colección Postman no contiene credenciales ni tokens', () => {
    assert.doesNotMatch(postmanRaw, /eyJ[A-Za-z0-9_-]{10,}|APP_USR-|TEST-[0-9]{6,}|postgres:\/\//);
    const vars = Object.fromEntries(postman.variable.map((item) => [item.key, item.value]));
    for (const key of ['accessToken', 'email', 'password']) assert.equal(vars[key], '', key);
});

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const dbState = {
    queryHandler: async () => ({ rows: [], rowCount: 0 }),
    client: null,
};
const queryCalls = [];

mock.module('../src/database/db.js', {
    defaultExport: {
        query: async (sql, params) => {
            queryCalls.push({ sql, params });
            return dbState.queryHandler(sql, params);
        },
        connect: async () => dbState.client,
    },
});

mock.module('../src/database/dbClient.js', {
    namedExports: {
        pool: { query: async () => { throw new Error('sin base de datos en tests'); } },
    },
});

const [
    { default: UsuarioService },
    { default: ReservaService },
    { default: ReservaRepository },
    { default: UsuarioRepository },
    { default: authMiddleware },
    { getTenantCondition },
] = await Promise.all([
    import('../src/services/usuarioService.js'),
    import('../src/services/reservaService.js'),
    import('../src/repositories/reservaRepository.js'),
    import('../src/repositories/usuarioRepository.js'),
    import('../src/middlewares/authMiddleware.js'),
    import('../src/helpers/tenantFilter.js'),
]);

const garagista = { id: 30, id_rol: 3, tipo_rol: 'garagista', id_sede: null, id_empresa: null };
const superadmin = { id: 99, id_rol: 4, tipo_rol: 'superadmin' };

function usuarioServiceFixture({ rol = { id: 3, tipo_rol: 'garagista' }, current = null } = {}) {
    const svc = new UsuarioService();
    const state = { created: null, createdWithClient: null, updated: null, links: [] };
    dbState.client = {
        query: async (sql) => {
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
            throw new Error(`SQL inesperado: ${sql}`);
        },
        release: () => {},
    };
    svc.rolService = { getByIdAsync: async () => rol };
    svc.repo = {
        getByIdAsync: async () => current,
        getByEmailAsync: async () => null,
        createAsync: async (entity) => { state.created = entity; return { id: 25, ...entity }; },
        createWithClientAsync: async (entity) => { state.createdWithClient = entity; return { id: 25, ...entity }; },
        updateAsync: async (id, entity) => { state.updated = entity; return { id, ...entity }; },
    };
    svc.garageService = { getByIdAsync: async () => ({ id: 4 }) };
    svc.sedeService = { getByIdAsync: async () => ({ id: 9 }) };
    svc.empresaService = { getByIdAsync: async () => ({ id: 7 }) };
    svc.usuarioGarageService = {
        createWithClientAsync: async (idUsuario, idGarage) => { state.links.push([idUsuario, idGarage]); },
        getUsuariosByGarageIdAsync: async () => [],
    };
    return { svc, state };
}

// ─── Creacion y actualizacion de garagistas ───────────────────────

test('crear un garagista fuerza id_sede e id_empresa a NULL', async () => {
    const { svc, state } = usuarioServiceFixture();
    await svc.createAsync({
        id_rol: 3, nombre: 'Gara', apellido: 'Gista', email: 'gara@test.com',
        contraseña: 'hash', id_sede: 9, id_empresa: 7, id_garage: 4, activo: true,
    });

    assert.equal(state.createdWithClient.id_sede, null);
    assert.equal(state.createdWithClient.id_empresa, null);
});

test('crear un garagista lo relaciona mediante usuario_garage', async () => {
    const { svc, state } = usuarioServiceFixture();
    await svc.createAsync({
        id_rol: 3, nombre: 'Gara', apellido: 'Gista', email: 'gara@test.com',
        contraseña: 'hash', id_sede: 9, id_empresa: 7, id_garage: 4, activo: true,
    });

    assert.deepEqual(state.links, [[25, 4]]);
});

test('el frontend no puede imponer sede ni empresa a un garagista al crearlo', async () => {
    const { svc, state } = usuarioServiceFixture();
    await svc.createAsync({
        id_rol: 3, nombre: 'Gara', apellido: 'Gista', email: 'gara@test.com',
        contraseña: 'hash', id_sede: 999, id_empresa: 888, id_garage: 4, activo: true,
    });

    assert.equal(state.createdWithClient.id_sede, null);
    assert.equal(state.createdWithClient.id_empresa, null);
});

test('crear un empleado conserva id_sede e id_empresa', async () => {
    const { svc, state } = usuarioServiceFixture({ rol: { id: 2, tipo_rol: 'empleado' } });
    await svc.createAsync({
        id_rol: 2, nombre: 'Empleado', apellido: 'Test', email: 'empleado@test.com',
        contraseña: 'hash', id_sede: 9, id_empresa: 7, activo: true,
    });

    assert.equal(state.created.id_sede, 9);
    assert.equal(state.created.id_empresa, 7);
});

test('actualizar un garagista fuerza id_sede e id_empresa a NULL aunque el frontend los envie', async () => {
    const current = {
        id: 25, id_rol: 3, tipo_rol: 'garagista', id_sede: 9, id_empresa: 7,
        nombre: 'Gara', apellido: 'Gista', email: 'gara@test.com', contraseña: 'hash',
        activo: true, token_version: 0,
    };
    const { svc, state } = usuarioServiceFixture({ current });
    await svc.updateAsync(25, { id_sede: 9, id_empresa: 7, telefono: '1123456789' }, superadmin);

    assert.equal(state.updated.id_sede, null);
    assert.equal(state.updated.id_empresa, null);
});

test('cambiar el rol de un usuario a garagista limpia sede y empresa', async () => {
    const current = {
        id: 60, id_rol: 2, tipo_rol: 'empleado', id_sede: 9, id_empresa: 7,
        nombre: 'Empleado', apellido: 'Test', email: 'empleado@test.com', contraseña: 'hash',
        activo: true, token_version: 0,
    };
    const { svc, state } = usuarioServiceFixture({ rol: { id: 3, tipo_rol: 'garagista' }, current });
    await svc.updateAsync(60, { id_rol: 3 }, superadmin);

    assert.equal(state.updated.id_sede, null);
    assert.equal(state.updated.id_empresa, null);
});

test('actualizar un admin no pierde empresa ni sede', async () => {
    const current = {
        id: 50, id_rol: 1, tipo_rol: 'admin', id_sede: 9, id_empresa: 7,
        nombre: 'Admin', apellido: 'Test', email: 'admin@test.com', contraseña: 'hash',
        activo: true, token_version: 0,
    };
    const { svc, state } = usuarioServiceFixture({ rol: { id: 1, tipo_rol: 'admin' }, current });
    await svc.updateAsync(50, { id_sede: 9, id_empresa: 7, nombre: 'Admin2' }, superadmin);

    assert.equal(state.updated.id_sede, 9);
    assert.equal(state.updated.id_empresa, 7);
});

test('los usuarios listados por garage no exponen el hash de la contrasena', async () => {
    const { svc } = usuarioServiceFixture();
    svc.usuarioGarageService = {
        getUsuariosByGarageIdAsync: async () => [{ id: 25, nombre: 'Gara', contraseña: 'hash-secreto' }],
    };
    const rows = await svc.getGaragistasByGarageIdAsync(4, { id: 1, id_rol: 1 });

    assert.deepEqual(rows, [{ id: 25, nombre: 'Gara' }]);
});

// ─── Filtro multi-tenant ──────────────────────────────────────────

test('getTenantCondition usa usuario_garage para un garagista sin sede ni empresa', () => {
    const tenant = getTenantCondition(garagista, 3, {
        sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa', garageColumn: 'r.id_garage',
    });

    assert.match(tenant.sql, /usuario_garage/);
    assert.match(tenant.sql, /r\.id_garage/);
    assert.deepEqual(tenant.params, [30]);
    assert.doesNotMatch(tenant.sql, /AND false/);
});

test('getTenantCondition mantiene fail-closed para garagista sin garageColumn', () => {
    const tenant = getTenantCondition(garagista, 2, {
        sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa',
    });

    assert.equal(tenant.sql, ' AND false');
    assert.deepEqual(tenant.params, []);
});

test('getTenantCondition conserva el aislamiento por sede y empresa de los demas roles', () => {
    const porSede = getTenantCondition({ id: 1, id_rol: 1, tipo_rol: 'admin', id_sede: 9, id_empresa: 7 }, 1, {
        sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa',
    });
    assert.equal(porSede.sql, ' AND u.id_sede = $1');
    assert.deepEqual(porSede.params, [9]);

    const porEmpresa = getTenantCondition({ id: 1, id_rol: 1, tipo_rol: 'admin', id_empresa: 7 }, 1, {
        sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa',
    });
    assert.equal(porEmpresa.sql, ' AND u.id_empresa = $1');
    assert.deepEqual(porEmpresa.params, [7]);
});

// ─── Sesion y /api/usuario/me ─────────────────────────────────────

test('authMiddleware rehidrata id_garage/id_garages del garagista (usado por /api/usuario/me)', async () => {
    queryCalls.length = 0;
    dbState.queryHandler = async () => ({
        rows: [{ id_rol: 3, id_empresa: null, id_sede: null, tipo_rol: 'garagista', id_garage: 4, id_garages: [4, 9] }],
        rowCount: 1,
    });
    const token = jwt.sign({ id: 25, id_rol: 3, id_empresa: 7, id_sede: 9 }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    const res = { status() { return this; }, json() { return this; }, clearCookie() {} };
    let nextCalled = false;

    await authMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.usuario.id_sede, null);
    assert.equal(req.usuario.id_empresa, null);
    assert.equal(req.usuario.id_garage, 4);
    assert.deepEqual(req.usuario.id_garages, [4, 9]);
    assert.match(queryCalls.at(-1).sql, /usuario_garage/);
});

test('un garagista puede leer su propio usuario sin sede ni empresa', async () => {
    queryCalls.length = 0;
    dbState.queryHandler = async () => ({
        rows: [{ id: 25, id_rol: 3, tipo_rol: 'garagista', id_garages: [4] }],
        rowCount: 1,
    });
    const repo = new UsuarioRepository();
    const row = await repo.getByIdAsync(25, { ...garagista, id: 25 });

    assert.equal(row.id, 25);
    assert.deepEqual(row.id_garages, [4]);
    assert.doesNotMatch(queryCalls.at(-1).sql, /AND false/);
});

test('un garagista no puede leer el usuario de otro tenant', async () => {
    queryCalls.length = 0;
    dbState.queryHandler = async () => ({ rows: [], rowCount: 0 });
    const repo = new UsuarioRepository();
    await repo.getByIdAsync(99, { ...garagista, id: 25 });

    assert.match(queryCalls.at(-1).sql, /AND false/);
});

// ─── Control de acceso ────────────────────────────────────────────

test('un garagista puede consultar el control de acceso de su garage', async () => {
    const svc = new ReservaService();
    svc.garageService = { getByIdAsync: async (id, user) => (Number(id) === 8 && user.id === 30 ? { id: 8 } : null) };
    svc.repo = { getControlAccesoAsync: async () => [{ id: 1 }] };

    const data = await svc.getControlAccesoAsync(8, '2026-09-18', garagista);
    assert.deepEqual(data, [{ id: 1 }]);
});

test('un garagista no puede consultar el control de acceso de otro garage', async () => {
    const svc = new ReservaService();
    svc.garageService = { getByIdAsync: async () => null };
    svc.repo = { getControlAccesoAsync: async () => { throw new Error('no debe consultarse'); } };

    await assert.rejects(
        svc.getControlAccesoAsync(99, '2026-09-18', garagista),
        { statusCode: 404 },
    );
});

test('la consulta de control de acceso filtra por usuario_garage y no por AND false', async () => {
    queryCalls.length = 0;
    dbState.queryHandler = async () => ({ rows: [], rowCount: 0 });
    const repo = new ReservaRepository();
    await repo.getControlAccesoAsync(8, '2026-09-18', garagista);

    const call = queryCalls.at(-1);
    assert.match(call.sql, /usuario_garage/);
    assert.doesNotMatch(call.sql, /AND false/);
    assert.deepEqual(call.params, [8, '2026-09-18', 30]);
});

// ─── Migracion ────────────────────────────────────────────────────

test('la migracion corrige solo garagistas y no toca usuario_garage', async () => {
    const migration = await readFile(
        new URL('../migrations/20260918_004_garagistas_sin_empresa_sede.sql', import.meta.url),
        'utf8',
    );

    assert.match(migration, /lower\(trim\(tipo_rol\)\) = 'garagista'/);
    assert.match(migration, /SET id_sede = NULL,\s*\n\s*id_empresa = NULL/);
    assert.match(migration, /DROP NOT NULL/);
    assert.match(migration, /^BEGIN;/m);
    assert.match(migration, /^COMMIT;/m);
    assert.doesNotMatch(migration, /(?:DELETE|UPDATE|INSERT)\s+(?:FROM|INTO)?\s*usuario_garage/i);
    assert.doesNotMatch(migration, /DELETE FROM usuarios/i);
    assert.doesNotMatch(migration, /TRUNCATE|CASCADE/i);
});

test('el controller delega la regla al servicio y no exige empresa al garagista', async () => {
    const controller = await readFile(
        new URL('../src/controllers/usuarioController.js', import.meta.url),
        'utf8',
    );

    assert.match(controller, /!esGaragista && !isValidId\(id_empresa\)/);
    assert.doesNotMatch(controller, /id_sede debe ser nulo o un número válido para el garagista/);
});

test.after(() => mock.restoreAll());

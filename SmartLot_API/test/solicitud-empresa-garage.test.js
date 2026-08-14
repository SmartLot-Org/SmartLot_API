import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import SolicitudEmpresaGarageService from '../src/services/solicitudEmpresaGarageService.js';
import SolicitudEmpresaGarageRepository from '../src/repositories/solicitudEmpresaGarageRepository.js';
import TratoEmpresaGarageService from '../src/services/tratoEmpresaGarageService.js';
import { ESTADOS_SOLICITUD, puedeTransicionarSolicitud } from '../src/helpers/estadosSolicitud.js';

const admin = { id: 1, id_rol: 1, tipo_rol: 'admin', id_empresa: 10 };
const adminSede = { ...admin, id_sede: 7 };
const otroAdmin = { ...admin, id: 2, id_empresa: 20 };
const owner = { id: 30, tipo_rol: 'dueño_garage' };
const otroOwner = { id: 31, tipo_rol: 'dueño_garage' };
const superadmin = { id: 99, id_rol: 4, tipo_rol: 'superadmin' };

function serviceFixture() {
    const svc = new SolicitudEmpresaGarageService();
    const rows = [{ id: 1, id_sede: 7, id_empresa: 10, id_garage: 5, estado: ESTADOS_SOLICITUD.PENDIENTE }];
    svc.repo = {
        createPendingAsync: async (e) => ({ id: 2, estado: ESTADOS_SOLICITUD.PENDIENTE, ...e }),
        getSentByEmpresaAsync: async (id) => rows.filter(r => r.id_empresa === id),
        getReceivedByOwnerAsync: async (id) => id === owner.id ? rows : [],
        getByIdAsync: async (id) => rows.find(r => r.id === id) || null,
        ownerHasGarageAsync: async (id, garage) => id === owner.id && garage === 5,
        acceptAsync: async (id, user) => ({ solicitud: { id, estado: 'aceptada' }, user }),
        rejectAsync: async (id) => ({ id, estado: 'rechazada' }),
        cancelAsync: async (id) => ({ id, estado: 'cancelada' }),
    };
    svc.notificacionService = { crearAsync: async () => {} };
    return svc;
}

test('admin debe enviar sede y el body no puede falsificar empresa ni estado', async () => {
    await assert.rejects(() => serviceFixture().createAsync({ id_garage: 5, cantidad_cocheras: 2 }, admin), { statusCode: 400 });
    const row = await serviceFixture().createAsync({ id_empresa: 999, id_sede: 7, id_garage: 5, cantidad_cocheras: 2, estado: 'aceptada' }, admin);
    assert.deepEqual([row.id_sede, row.id_empresa_autorizada, row.estado], [7, 10, 'pendiente']);
});
test('admin limitado a sede no puede usar otra', async () => {
    await assert.rejects(() => serviceFixture().createAsync({ id_sede: 8, id_garage: 5, cantidad_cocheras: 2 }, adminSede), { statusCode: 403 });
});
test('descripcion opcional se recorta y valida longitud/tipo', async () => {
    const svc = serviceFixture();
    assert.equal((await svc.createAsync({ id_sede: 7, id_garage: 5, cantidad_cocheras: 1, descripcion: ' hola ' }, admin)).descripcion, 'hola');
    await assert.rejects(() => svc.createAsync({ id_sede: 7, id_garage: 5, cantidad_cocheras: 1, descripcion: 2 }, admin), { statusCode: 400 });
    await assert.rejects(() => svc.createAsync({ id_sede: 7, id_garage: 5, cantidad_cocheras: 1, descripcion: 'x'.repeat(1001) }, admin), { statusCode: 400 });
});
for (const cantidad of [0, -1, 1.5]) test(`rechaza cantidad inválida ${cantidad}`, async () => {
    await assert.rejects(() => serviceFixture().createAsync({ id_sede: 7, id_garage: 5, cantidad_cocheras: cantidad }, admin), { statusCode: 400 });
});
test('admin solo ve enviadas de su empresa', async () => {
    assert.deepEqual((await serviceFixture().getSentAsync(admin)).map(r => r.id_empresa), [10]);
    assert.deepEqual(await serviceFixture().getSentAsync(otroAdmin), []);
});
test('dueño solo ve recibidas de sus garages', async () => {
    assert.equal((await serviceFixture().getReceivedAsync(owner)).length, 1);
    assert.equal((await serviceFixture().getReceivedAsync(otroOwner)).length, 0);
});
test('acceso por ID respeta empresa, propiedad y superadmin', async () => {
    const svc = serviceFixture();
    assert.equal((await svc.getByIdAsync(1, admin)).id, 1);
    assert.equal((await svc.getByIdAsync(1, owner)).id, 1);
    assert.equal((await svc.getByIdAsync(1, superadmin)).id, 1);
    await assert.rejects(() => svc.getByIdAsync(1, otroAdmin), { statusCode: 403 });
    await assert.rejects(() => svc.getByIdAsync(1, otroOwner), { statusCode: 403 });
});
test('admin no acepta ni rechaza y dueño no cancela', async () => {
    const svc = serviceFixture();
    await assert.rejects(() => svc.acceptAsync(1, admin), { statusCode: 403 });
    await assert.rejects(() => svc.rejectAsync(1, admin), { statusCode: 403 });
    await assert.rejects(() => svc.cancelAsync(1, owner), { statusCode: 403 });
});

class FakeClient {
    constructor(handler) { this.handler = handler; this.commands = []; this.released = false; }
    async query(sql, params = []) { this.commands.push({ sql, params }); return this.handler(sql, params); }
    release() { this.released = true; }
}
const command = (client, value) => client.commands.some(c => c.sql === value);
const baseRequest = { id: 1, id_sede: 7, id_garage: 5, cantidad_cocheras: 3, estado: 'pendiente', descripcion: 'x' };
const baseGarage = { id: 5, capacidad: 10, estado: true, Borrado: false, precio_auto: 100, precio_moto: 50, precio_pickup: 150 };

function acceptanceFixture({ request = baseRequest, garage = baseGarage, owns = true, deal = null, used = 2, createError = null, updateCount = 1 } = {}) {
    const repo = new SolicitudEmpresaGarageRepository();
    let created = 0;
    const client = new FakeClient(async (sql) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM solicitudes WHERE id=$1 FOR UPDATE')) return { rows: request ? [request] : [], rowCount: request ? 1 : 0 };
        if (sql.includes('FROM usuario_garage')) return { rows: owns ? [{ '?column?': 1 }] : [], rowCount: owns ? 1 : 0 };
        if (sql.includes('FROM sedes')) return { rows: [{ id: 7, id_empresa: 10 }], rowCount: 1 };
        if (sql.includes('FROM garages')) return { rows: garage ? [garage] : [], rowCount: garage ? 1 : 0 };
        if (sql.startsWith('UPDATE solicitudes')) return { rows: updateCount ? [{ ...request, estado: 'aceptada' }] : [], rowCount: updateCount };
        throw new Error(`SQL inesperado: ${sql}`);
    });
    repo.pool = { connect: async () => client };
    repo.tratoRepo = {
        getBySedeGarageWithClientAsync: async () => deal,
        sumCantidadByGarageWithClientAsync: async () => used,
        createWithClientAsync: async (entity, sameClient) => {
            assert.equal(sameClient, client); created += 1;
            if (createError) throw createError;
            return { id: 8, ...entity };
        },
    };
    return { repo, client, created: () => created };
}

test('aceptar crea exactamente un trato con sede, garage, cantidad y precios, sin empresa insertada', async () => {
    const fx = acceptanceFixture();
    const result = await fx.repo.acceptAsync(1, owner.id);
    assert.equal(fx.created(), 1);
    assert.deepEqual(result.trato, { id: 8, id_sede: 7, id_garage: 5, cantidad_cocheras: 3, precio_auto: 100, precio_moto: 50, precio_pickup: 150 });
    assert.ok(command(fx.client, 'BEGIN') && command(fx.client, 'COMMIT'));
});
test('dueño no acepta solicitud de garage ajeno', async () => {
    const fx = acceptanceFixture({ owns: false });
    await assert.rejects(() => fx.repo.acceptAsync(1, otroOwner.id), { statusCode: 403 });
    assert.ok(command(fx.client, 'ROLLBACK')); assert.equal(fx.created(), 0);
});
test('aceptar dos veces o con trato existente no duplica', async () => {
    await assert.rejects(() => acceptanceFixture({ request: { ...baseRequest, estado: 'aceptada' } }).repo.acceptAsync(1, owner.id), { statusCode: 409 });
    const fx = acceptanceFixture({ deal: { id: 2 } });
    await assert.rejects(() => fx.repo.acceptAsync(1, owner.id), { statusCode: 409 });
    assert.equal(fx.created(), 0);
});
test('aceptar rechaza capacidad insuficiente después de volver a calcularla', async () => {
    const fx = acceptanceFixture({ used: 8 });
    await assert.rejects(() => fx.repo.acceptAsync(1, owner.id), { statusCode: 409 });
    assert.equal(fx.created(), 0); assert.ok(command(fx.client, 'ROLLBACK'));
});
test('aceptar hace rollback si falla crear el trato', async () => {
    const fx = acceptanceFixture({ createError: new Error('falló trato') });
    await assert.rejects(() => fx.repo.acceptAsync(1, owner.id), /falló trato/);
    assert.ok(command(fx.client, 'ROLLBACK')); assert.ok(!command(fx.client, 'COMMIT'));
});
test('aceptar hace rollback si la actualización condicional pierde la carrera', async () => {
    const fx = acceptanceFixture({ updateCount: 0 });
    await assert.rejects(() => fx.repo.acceptAsync(1, owner.id), { statusCode: 409 });
    assert.equal(fx.created(), 1); assert.ok(command(fx.client, 'ROLLBACK'));
});

function createFixture({ sede = { id: 7, id_empresa: 10 }, garage = baseGarage, deal = null, pending = null, used = 2 } = {}) {
    const repo = new SolicitudEmpresaGarageRepository();
    const client = new FakeClient(async (sql, params) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM sedes')) return { rows: sede ? [sede] : [], rowCount: sede ? 1 : 0 };
        if (sql.includes('FROM garages')) return { rows: garage ? [garage] : [], rowCount: garage ? 1 : 0 };
        if (sql.includes('FROM solicitudes') && sql.includes('estado=$3')) return { rows: pending ? [pending] : [], rowCount: pending ? 1 : 0 };
        if (sql.startsWith('INSERT INTO solicitudes')) return { rows: [{ id: 3, id_sede: params[0], estado: params[4] }], rowCount: 1 };
        throw new Error(`SQL inesperado: ${sql}`);
    });
    repo.pool = { connect: async () => client };
    repo.tratoRepo = {
        getBySedeGarageWithClientAsync: async () => deal,
        sumCantidadByGarageWithClientAsync: async () => used,
    };
    return { repo, client };
}
const createEntity = { id_sede: 7, id_empresa_autorizada: 10, id_garage: 5, cantidad_cocheras: 3, descripcion: null };
test('crear rechaza una sede de otra empresa', async () => {
    await assert.rejects(() => createFixture({ sede: { id: 7, id_empresa: 20 } }).repo.createPendingAsync(createEntity), { statusCode: 403 });
});
test('crear bloquea garage y fuerza enum pendiente', async () => {
    const fx = createFixture(); const row = await fx.repo.createPendingAsync(createEntity);
    assert.equal(row.estado, 'pendiente'); assert.ok(fx.client.commands.some(c => /garages WHERE id=\$1 FOR UPDATE/.test(c.sql)));
});
test('crear rechaza garage inexistente, borrado o cerrado', async () => {
    await assert.rejects(() => createFixture({ garage: null }).repo.createPendingAsync(createEntity), { statusCode: 404 });
    await assert.rejects(() => createFixture({ garage: { ...baseGarage, Borrado: true } }).repo.createPendingAsync(createEntity), { statusCode: 404 });
    await assert.rejects(() => createFixture({ garage: { ...baseGarage, estado: false } }).repo.createPendingAsync(createEntity), { statusCode: 409 });
});
test('crear rechaza pendiente duplicada, trato existente y sobreasignación', async () => {
    await assert.rejects(() => createFixture({ pending: { id: 7 } }).repo.createPendingAsync(createEntity), { statusCode: 409 });
    await assert.rejects(() => createFixture({ deal: { id: 8 } }).repo.createPendingAsync(createEntity), { statusCode: 409 });
    await assert.rejects(() => createFixture({ used: 9 }).repo.createPendingAsync(createEntity), { statusCode: 409 });
});

test('rechazar y cancelar no crean tratos y preservan descripción', async () => {
    const repo = new SolicitudEmpresaGarageRepository();
    const states = [];
    const client = new FakeClient(async (sql, params) => {
        if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT * FROM solicitudes') || sql.includes('SELECT so.*')) return { rows: [{ ...baseRequest, id_empresa: 10 }], rowCount: 1 };
        if (sql.includes('usuario_garage')) return { rows: [{}], rowCount: 1 };
        if (sql.startsWith('UPDATE solicitudes')) { states.push(params[0]); return { rows: [{ ...baseRequest, estado: params[0] }], rowCount: 1 }; }
        throw new Error(`SQL inesperado: ${sql}`);
    });
    repo.pool = { connect: async () => client };
    assert.equal((await repo.rejectAsync(1, owner.id)).descripcion, 'x');
    assert.equal((await repo.cancelAsync(1, admin.id_empresa)).descripcion, 'x');
    assert.deepEqual(states, ['rechazada', 'cancelada']);
});
test('admin no cancela solicitud ajena y transiciones no pendientes devuelven 409', async () => {
    const repo = new SolicitudEmpresaGarageRepository();
    const client = new FakeClient(async (sql) => {
        if (['BEGIN','ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT * FROM solicitudes') || sql.includes('SELECT so.*')) return { rows: [{ ...baseRequest, id_empresa: 20, estado: 'aceptada' }], rowCount: 1 };
        throw new Error('no debe actualizar');
    });
    repo.pool = { connect: async () => client };
    await assert.rejects(() => repo.cancelAsync(1, admin.id_empresa), { statusCode: 403 });
    const ownClient = new FakeClient(async (sql) => ['BEGIN','ROLLBACK'].includes(sql) ? { rows: [] } : { rows: [{ ...baseRequest, id_empresa: 10, estado: 'rechazada' }], rowCount: 1 });
    repo.pool = { connect: async () => ownClient };
    await assert.rejects(() => repo.cancelAsync(1, admin.id_empresa), { statusCode: 409 });
});
test('constantes usan exactamente los strings del enum y solo transiciones permitidas', () => {
    assert.deepEqual(Object.values(ESTADOS_SOLICITUD), ['pendiente','aceptada','rechazada','cancelada']);
    assert.equal(puedeTransicionarSolicitud('pendiente','aceptada'), true);
    assert.equal(puedeTransicionarSolicitud('aceptada','rechazada'), false);
    assert.equal(puedeTransicionarSolicitud('cancelada','aceptada'), false);
});
test('admin no puede crear trato directamente ni siquiera invocando el service', async () => {
    await assert.rejects(() => new TratoEmpresaGarageService().createAsync({}, admin), { statusCode: 403 });
});

const repoSource = await readFile(new URL('../src/repositories/solicitudEmpresaGarageRepository.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../src/controllers/solicitudEmpresaGarageController.js', import.meta.url), 'utf8');
const tratoControllerSource = await readFile(new URL('../src/controllers/tratoEmpresaGarageController.js', import.meta.url), 'utf8');
test('repositorio parametriza entradas y listados usan joins sin N+1', () => {
    assert.doesNotMatch(repoSource, /\$\{(?:idUsuario|idEmpresa|idGarage|id)\}/);
    assert.match(repoSource, /JOIN empresas/); assert.match(repoSource, /JOIN garages/);
});
test('rutas estáticas preceden a /:id y no hay PATCH genérico', () => {
    assert.ok(controllerSource.indexOf("get('/enviadas'") < controllerSource.indexOf("get('/:id'"));
    assert.ok(controllerSource.indexOf("get('/recibidas'") < controllerSource.indexOf("get('/:id'"));
    assert.doesNotMatch(controllerSource, /patch\('\/:id'\s*,/);
});
test('endpoint histórico permite admin pero lo deriva a solicitud sin crear trato directo', () => {
    assert.match(tratoControllerSource, /router\.post\('', requireRole\(1, 4, ROLE_NAMES\.ADMIN/);
    assert.match(tratoControllerSource, /solicitudSvc\.createAsync/);
    assert.match(tratoControllerSource, /hasRole\(req\.usuario, 4, ROLE_NAMES\.SUPERADMIN\)/);
});

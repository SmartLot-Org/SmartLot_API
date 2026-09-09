import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sends = [];

mock.module('mailtrap', {
    namedExports: {
        MailtrapClient: class {
            constructor(config) { this.config = config; }
            async send(params) {
                sends.push(params);
                return { success: true, message_ids: ['msg-1'] };
            }
        }
    }
});

mock.module('../src/database/dbClient.js', {
    namedExports: {
        pool: {
            query: async () => { throw new Error('DB caída'); }
        }
    }
});

const { default: SolicitudRegistroService } = await import('../src/services/solicitudRegistroService.js');
const { default: SolicitudRegistroRepository } = await import('../src/repositories/solicitudRegistroRepository.js');
const { ESTADOS_SOLICITUD, puedeTransicionarSolicitud } = await import('../src/helpers/estadosSolicitud.js');
const { isValidStrongPassword } = await import('../src/helpers/validatorHelper.js');

const STRONG_PASSWORD = 'SEgura12!!';
const superadmin = { id: 99, id_rol: 4, tipo_rol: 'superadmin' };

const baseInput = {
    nombre: 'Ana',
    apellido: 'Gómez',
    email: 'ana@empresa.com',
    telefono: '1123456789',
    contraseña: STRONG_PASSWORD,
    empresa_nombre: 'Transportes del Sur',
    empresa_descripcion: 'Flota de reparto',
};

function serviceFixture({ pendingByEmail = false, existingUser = null, rolAdmin = { id: 1, tipo_rol: 'admin' } } = {}) {
    const svc = new SolicitudRegistroService();
    let created = null;
    svc.repo = {
        createPendingAsync: async (e) => { created = e; return { id: 7, estado: 'pendiente', ...e }; },
        hasPendingByEmailAsync: async () => pendingByEmail,
        getAllAsync: async (estado) => [{ id: 1, estado: estado ?? 'pendiente' }],
        approveAsync: async (id, opts) => ({
            solicitud: { id, estado: 'aceptada', revisada_por: opts.idRevisor },
            empresa: { id: 10, nombre: 'Transportes del Sur' },
            usuario: { id: 20, id_rol: opts.idRolAdmin, email: 'ana@empresa.com', nombre: 'Ana', contraseña: 'hash-guardado' },
        }),
        rejectAsync: async (id, idRevisor) => ({ id, estado: 'rechazada', revisada_por: idRevisor }),
    };
    svc.usuarioRepo = { getByEmailAsync: async () => existingUser };
    svc.rolService = { getByIdAsync: async () => rolAdmin };
    return { svc, created: () => created };
}

test('política fuerte exige 8+, 2 mayúsculas, 2 números y 2 especiales', () => {
    assert.equal(isValidStrongPassword('SEgura12!!'), true);
    for (const debil of ['corta1A!', 'segura12!!', 'SEGURA!!xx', 'SeguraAAxx', 'Segura12xx', 'Segura1!x', 123, null, undefined]) {
        assert.equal(isValidStrongPassword(debil), false);
    }
});

test('crear valida campos requeridos y formatos', async () => {
    const { svc } = serviceFixture();
    await assert.rejects(() => svc.createAsync({ ...baseInput, nombre: ' ' }), { message: 'El nombre es requerido.' });
    await assert.rejects(() => svc.createAsync({ ...baseInput, apellido: '' }), { message: 'El apellido es requerido.' });
    await assert.rejects(() => svc.createAsync({ ...baseInput, email: 'no-es-email' }), { message: 'El email no tiene un formato válido.' });
    await assert.rejects(() => svc.createAsync({ ...baseInput, telefono: '11-2233' }), { message: 'El teléfono debe contener solo dígitos (mínimo 7).' });
    await assert.rejects(() => svc.createAsync({ ...baseInput, contraseña: 'Debil123' }), { statusCode: 400 });
    await assert.rejects(() => svc.createAsync({ ...baseInput, empresa_nombre: 'X' }), { statusCode: 400 });
    await assert.rejects(() => svc.createAsync({ ...baseInput, empresa_descripcion: 5 }), { message: 'La descripción de la empresa debe ser un texto.' });
    await assert.rejects(() => svc.createAsync({ ...baseInput, empresa_descripcion: 'x'.repeat(1001) }), { statusCode: 400 });
});

test('crear rechaza email de usuario existente o solicitud pendiente', async () => {
    await assert.rejects(
        () => serviceFixture({ existingUser: { id: 1 } }).svc.createAsync(baseInput),
        { statusCode: 409 }
    );
    await assert.rejects(
        () => serviceFixture({ pendingByEmail: true }).svc.createAsync(baseInput),
        { message: 'Ya existe una solicitud pendiente con ese email.' }
    );
});

test('crear hashea la contraseña y el servidor decide el estado', async () => {
    const { svc, created } = serviceFixture();
    const row = await svc.createAsync({ ...baseInput, estado: 'aceptada', id_empresa: 999, email: '  ANA@empresa.com ' });
    assert.equal(row.estado, 'pendiente');
    assert.equal(created().email, 'ana@empresa.com');
    assert.equal(created().telefono, '1123456789');
    assert.ok(created().contraseña_hash && created().contraseña_hash !== STRONG_PASSWORD);
    assert.match(created().contraseña_hash, /^\$2[aby]\$/);
    assert.equal(created().estado, undefined);
});

test('crear normaliza teléfono vacío a null y recorta descripción', async () => {
    const { svc, created } = serviceFixture();
    await svc.createAsync({ ...baseInput, telefono: '  ', empresa_descripcion: '  flota  ' });
    assert.equal(created().telefono, null);
    assert.equal(created().empresa_descripcion, 'flota');
});

test('aprobar exige rol admin configurado y devuelve el usuario sin hash', async () => {
    await assert.rejects(
        () => serviceFixture({ rolAdmin: { id: 1, tipo_rol: 'cliente' } }).svc.approveAsync(7, superadmin),
        { statusCode: 500 }
    );
    await assert.rejects(
        () => serviceFixture({ rolAdmin: null }).svc.approveAsync(7, superadmin),
        { statusCode: 500 }
    );
    const { svc } = serviceFixture();
    sends.length = 0;
    const result = await svc.approveAsync(7, superadmin);
    assert.equal(result.usuario.contraseña, undefined);
    assert.equal(result.solicitud.revisada_por, superadmin.id);
    assert.equal(result.empresa.id, 10);
    assert.equal(sends.length, 1);
});

test('rechazar delega el id del revisor', async () => {
    const { svc } = serviceFixture();
    const row = await svc.rejectAsync(7, superadmin);
    assert.deepEqual([row.id, row.estado, row.revisada_por], [7, 'rechazada', superadmin.id]);
});

test('listar valida el filtro de estado', async () => {
    const { svc } = serviceFixture();
    assert.equal((await svc.getAllAsync(null))[0].id, 1);
    assert.equal((await svc.getAllAsync('pendiente'))[0].estado, 'pendiente');
    await assert.rejects(() => svc.getAllAsync('inventado'), { statusCode: 400 });
});

class FakeClient {
    constructor(handler) { this.handler = handler; this.commands = []; this.released = false; }
    async query(sql, params = []) { this.commands.push({ sql, params }); return this.handler(sql, params); }
    release() { this.released = true; }
}
const command = (client, value) => client.commands.some(c => c.sql === value);
const baseSolicitud = {
    id: 7, nombre: 'Ana', apellido: 'Gómez', email: 'ana@empresa.com', telefono: '1123456789',
    contraseña_hash: 'hash-guardado', empresa_nombre: 'Transportes del Sur', empresa_descripcion: 'Flota',
    estado: 'pendiente',
};

function approvalFixture({ solicitud = baseSolicitud, emailTaken = false, updateCount = 1, failEmpresa = false, failUsuario = false } = {}) {
    const repo = new SolicitudRegistroRepository();
    const created = { empresa: null, usuario: null };
    const client = new FakeClient(async (sql) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM solicitudes_registro WHERE id=$1 FOR UPDATE')) return { rows: solicitud ? [solicitud] : [], rowCount: solicitud ? 1 : 0 };
        if (sql.includes('FROM usuarios WHERE email=$1')) return { rows: emailTaken ? [{ id: 1 }] : [], rowCount: emailTaken ? 1 : 0 };
        if (sql.startsWith('UPDATE solicitudes_registro')) return { rows: updateCount ? [{ ...solicitud, estado: 'aceptada' }] : [], rowCount: updateCount };
        throw new Error(`SQL inesperado: ${sql}`);
    });
    repo.pool = { connect: async () => client };
    repo.empresaRepo = {
        createWithClientAsync: async (entity, sameClient) => {
            assert.equal(sameClient, client);
            if (failEmpresa) throw new Error('falló empresa');
            created.empresa = entity;
            return { id: 10, ...entity };
        },
    };
    repo.usuarioRepo = {
        createWithClientAsync: async (entity, sameClient) => {
            assert.equal(sameClient, client);
            if (failUsuario) throw new Error('falló usuario');
            if (entity.contraseña === STRONG_PASSWORD) throw new Error('la contraseña llegó sin hashear');
            created.usuario = entity;
            return { id: 20, ...entity };
        },
    };
    return { repo, client, created };
}

test('aprobar crea empresa y usuario admin enlazados en la misma transacción', async () => {
    const fx = approvalFixture();
    const result = await fx.repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 });
    assert.equal(result.empresa.nombre, 'Transportes del Sur');
    assert.deepEqual(fx.created.usuario, {
        id_rol: 1, nombre: 'Ana', apellido: 'Gómez', id_sede: null,
        email: 'ana@empresa.com', telefono: '1123456789', contraseña: 'hash-guardado',
        id_empresa: 10, activo: true, token_version: 0,
    });
    assert.equal(result.solicitud.estado, 'aceptada');
    assert.deepEqual(fx.client.commands.find(c => c.sql.startsWith('UPDATE solicitudes_registro')).params.slice(0, 2), ['aceptada', 99]);
    assert.ok(command(fx.client, 'BEGIN') && command(fx.client, 'COMMIT') && fx.client.released);
});

test('aprobar rechaza inexistente, no pendiente o email tomado', async () => {
    await assert.rejects(() => approvalFixture({ solicitud: null }).repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }), { statusCode: 404 });
    await assert.rejects(
        () => approvalFixture({ solicitud: { ...baseSolicitud, estado: 'aceptada' } }).repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }),
        { statusCode: 409 }
    );
    await assert.rejects(() => approvalFixture({ emailTaken: true }).repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }), { statusCode: 409 });
    const fx = approvalFixture({ emailTaken: true });
    await assert.rejects(() => fx.repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }), { statusCode: 409 });
    assert.ok(command(fx.client, 'ROLLBACK') && !command(fx.client, 'COMMIT'));
    assert.equal(fx.created.empresa, null);
});

test('aprobar hace rollback si falla crear empresa o usuario, o si pierde la carrera', async () => {
    const fxEmpresa = approvalFixture({ failEmpresa: true });
    await assert.rejects(() => fxEmpresa.repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }), /falló empresa/);
    assert.ok(command(fxEmpresa.client, 'ROLLBACK') && !command(fxEmpresa.client, 'COMMIT'));
    const fxUsuario = approvalFixture({ failUsuario: true });
    await assert.rejects(() => fxUsuario.repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }), /falló usuario/);
    assert.ok(command(fxUsuario.client, 'ROLLBACK') && !command(fxUsuario.client, 'COMMIT'));
    await assert.rejects(
        () => approvalFixture({ updateCount: 0 }).repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }),
        { statusCode: 409 }
    );
});

test('aprobar convierte violación de unicidad en 409', async () => {
    const fx = approvalFixture();
    const uniqueError = new Error('duplicado');
    uniqueError.code = '23505';
    fx.repo.usuarioRepo = { createWithClientAsync: async () => { throw uniqueError; } };
    await assert.rejects(() => fx.repo.approveAsync(7, { idRolAdmin: 1, idRevisor: 99 }), { statusCode: 409 });
    assert.ok(command(fx.client, 'ROLLBACK'));
});

test('rechazar actualiza estado con revisor y bloquea no pendientes', async () => {
    const repo = new SolicitudRegistroRepository();
    const client = new FakeClient(async (sql, params) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM solicitudes_registro WHERE id=$1 FOR UPDATE')) return { rows: [baseSolicitud], rowCount: 1 };
        if (sql.startsWith('UPDATE solicitudes_registro')) return { rows: [{ ...baseSolicitud, estado: params[0] }], rowCount: 1 };
        throw new Error(`SQL inesperado: ${sql}`);
    });
    repo.pool = { connect: async () => client };
    const row = await repo.rejectAsync(7, 99);
    assert.deepEqual([row.estado, row.id], ['rechazada', 7]);
    const update = client.commands.find(c => c.sql.startsWith('UPDATE solicitudes_registro'));
    assert.deepEqual(update.params, ['rechazada', 99, 7, 'pendiente']);
    const repo409 = new SolicitudRegistroRepository();
    const client409 = new FakeClient(async (sql) => {
        if (['BEGIN', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        return { rows: [{ ...baseSolicitud, estado: 'rechazada' }], rowCount: 1 };
    });
    repo409.pool = { connect: async () => client409 };
    await assert.rejects(() => repo409.rejectAsync(7, 99), { statusCode: 409 });
});

test('constantes de estado permiten pendiente -> aceptada/rechazada', () => {
    assert.ok([ESTADOS_SOLICITUD.PENDIENTE, ESTADOS_SOLICITUD.ACEPTADA, ESTADOS_SOLICITUD.RECHAZADA].every(Boolean));
    assert.equal(puedeTransicionarSolicitud('pendiente', 'aceptada'), true);
    assert.equal(puedeTransicionarSolicitud('pendiente', 'rechazada'), true);
    assert.equal(puedeTransicionarSolicitud('aceptada', 'rechazada'), false);
});

const repoSource = await readFile(new URL('../src/repositories/solicitudRegistroRepository.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../src/controllers/solicitudRegistroController.js', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../migrations/20260909_001_solicitudes_registro.sql', import.meta.url), 'utf8');
test('repositorio parametriza entradas y bloquea la fila al aprobar', () => {
    assert.doesNotMatch(repoSource, /\$\{(?:id|idRevisor|idRolAdmin|email|estado)\}/);
    assert.match(repoSource, /FROM solicitudes_registro WHERE id=\$1 FOR UPDATE/);
    assert.match(repoSource, /WHERE id=\$3 AND estado=\$4 RETURNING/);
});
test('rutas estáticas preceden a /:id y no hay PATCH genérico', () => {
    assert.ok(controllerSource.indexOf("router.post('', authRateLimiter") < controllerSource.indexOf("patch('/:id/aprobar'"));
    assert.ok(controllerSource.indexOf("router.get('', authMiddleware") < controllerSource.indexOf("patch('/:id/rechazar'"));
    assert.doesNotMatch(controllerSource, /patch\('\/:id'\s*,/);
});
test('migración crea la tabla con unicidad parcial de email pendiente', () => {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS solicitudes_registro/);
    assert.match(migrationSource, /contraseña_hash text NOT NULL/);
    assert.match(migrationSource, /WHERE estado = 'pendiente'/);
    assert.match(migrationSource, /^BEGIN;/m);
    assert.match(migrationSource, /^COMMIT;/m);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import NotificacionService from '../src/services/NotificacionService.js';

const garagista = { id: 40, id_rol: 3, tipo_rol: 'garagista' };
const duenio = { id: 30, id_rol: 5, tipo_rol: 'dueño_garage' };
const admin = { id: 1, id_rol: 1, tipo_rol: 'admin' };

function serviceFixture({ esGaragista = false } = {}) {
    const svc = new NotificacionService();
    const calls = { list: 0, count: 0, insert: 0 };
    svc.repo = {
        esGaragistaAsync: async () => esGaragista,
        insertarAsync: async (notificacion) => { calls.insert += 1; return { id: 1, ...notificacion }; },
        listByUsuarioAsync: async () => { calls.list += 1; return [{ id: 1 }]; },
        countNoLeidasByUsuarioAsync: async () => { calls.count += 1; return 3; },
    };
    return { svc, calls };
}

test('crearAsync no inserta notificaciones para garagistas', async () => {
    const { svc, calls } = serviceFixture({ esGaragista: true });
    const result = await svc.crearAsync(garagista.id, 'mensaje', 'solicitud_enviada', 'actor');
    assert.equal(result, null);
    assert.equal(calls.insert, 0);
});

test('crearAsync inserta para destinatarios válidos (dueño de garage y admin)', async () => {
    for (const destino of [duenio, admin]) {
        const { svc, calls } = serviceFixture({ esGaragista: false });
        const result = await svc.crearAsync(destino.id, 'mensaje', 'solicitud_enviada', 'actor', 5);
        assert.equal(result.id, 1);
        assert.equal(calls.insert, 1);
    }
});

test('listado y contador devuelven vacío/0 para garagistas sin consultar el repo', async () => {
    const { svc, calls } = serviceFixture();
    assert.deepEqual(await svc.listByUsuarioAsync(garagista), []);
    assert.equal(await svc.countNoLeidasAsync(garagista), 0);
    assert.equal(calls.list, 0);
    assert.equal(calls.count, 0);
});

test('listado y contador delegan para dueño y admin', async () => {
    const { svc, calls } = serviceFixture();
    assert.deepEqual(await svc.listByUsuarioAsync(duenio), [{ id: 1 }]);
    assert.equal(await svc.countNoLeidasAsync(admin), 3);
    assert.equal(calls.list, 1);
    assert.equal(calls.count, 1);
});

const solicitudSource = await readFile(new URL('../src/services/solicitudEmpresaGarageService.js', import.meta.url), 'utf8');
const tratoSource = await readFile(new URL('../src/services/tratoEmpresaGarageService.js', import.meta.url), 'utf8');
const solicitudRepoSource = await readFile(new URL('../src/repositories/solicitudEmpresaGarageRepository.js', import.meta.url), 'utf8');

test('los destinatarios de notificaciones de garage se resuelven solo para dueños', () => {
    for (const source of [solicitudSource, tratoSource]) {
        assert.match(source, /lower\(trim\(r\.tipo_rol\)\)\s*=\s*'dueño_garage'/);
        assert.doesNotMatch(source, /_obtenerUsuariosGarage/);
    }
});

test('los tipos de notificación de solicitudes están normalizados', () => {
    for (const tipo of ['solicitud_enviada', 'solicitud_aceptada', 'solicitud_rechazada', 'solicitud_cancelada']) {
        assert.match(solicitudSource, new RegExp(`'${tipo}'`));
    }
    assert.doesNotMatch(solicitudSource, /'solicitud_empresa_garage'/);
});

test('duenio_nombre solo agrega dueños de garage', () => {
    assert.match(solicitudRepoSource, /AS duenio_nombre/);
    assert.match(solicitudRepoSource, /lower\(trim\(rd\.tipo_rol\)\)\s*=\s*'dueño_garage'/);
});

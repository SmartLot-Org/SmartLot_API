import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import GarageService from '../src/services/garageService.js';

const admin = { id: 10, id_rol: 1, tipo_rol: 'admin', id_empresa: 1 };
const adminSede = { ...admin, id_sede: 8 };
const superadmin = { id: 1, id_rol: 4, tipo_rol: 'superadmin' };
const sede = {
    id: 7,
    id_empresa: 1,
    ubicacion: 'Av. Corrientes 1234, Buenos Aires',
    latitud: -34.6037,
    longitud: -58.3816,
};
const payload = {
    id_sede: 7,
    nombre: 'Garage sede central',
    piso: 0,
    hora_apertura: '08:00',
    hora_cierre: '18:00',
    dias: ['Lunes', 'Martes'],
    capacidad_reservas: 12,
    capacidad_para_no_reservas: 3,
    precio_auto: 100,
    precio_moto: 50,
    precio_pickup: 150,
};

function fixture({ sedeData = sede, propioExistente = null, insertError = null } = {}) {
    const commands = [];
    const garages = [];
    let connections = 0;
    const client = {
        query: async (sql, params = []) => {
            commands.push({ sql, params });
            if (sql.startsWith('INSERT INTO trato_empresa_garage') && insertError) throw insertError;
            return { rows: [], rowCount: 1 };
        },
        release: () => commands.push({ sql: 'RELEASE', params: [] }),
    };
    const svc = new GarageService();
    svc.sedeService = {
        getByIdAsync: async (id, user) => {
            assert.equal(id, 7);
            assert.ok(user);
            return sedeData;
        },
    };
    svc.repo = {
        getPropioBySedeAsync: async () => propioExistente,
        createPropioWithClientAsync: async (entity, sameClient) => {
            assert.equal(sameClient, client);
            garages.push(entity);
            return { id: 42, ...entity };
        },
    };
    svc.pool = {
        connect: async () => {
            connections += 1;
            return client;
        },
    };
    return { svc, commands, garages, getConnections: () => connections };
}

test('admin crea garage propio con la dirección de sede y trato en una transacción', async () => {
    const fx = fixture();
    const created = await fx.svc.createPropioAsync(payload, admin);
    const trato = fx.commands.find(({ sql }) => sql.startsWith('INSERT INTO trato_empresa_garage'));

    assert.equal(created.id_sede_propia, sede.id);
    assert.equal(created.ubicacion, sede.ubicacion);
    assert.equal(created.latitud, sede.latitud);
    assert.equal(created.longitud, sede.longitud);
    assert.equal(created.capacidad, 15);
    assert.equal(created.capacidad_reservas, 12);
    assert.equal(fx.garages.length, 1);
    assert.deepEqual(trato.params, [7, 42, 12, 150, 100, 50]);
    assert.ok(fx.commands.some(({ sql }) => sql === 'BEGIN'));
    assert.ok(fx.commands.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(fx.getConnections(), 1);
});

test('una sede no puede tener dos garages propios activos', async () => {
    const fx = fixture({ propioExistente: { id: 41 } });
    await assert.rejects(() => fx.svc.createPropioAsync(payload, admin), { statusCode: 409 });
    assert.equal(fx.getConnections(), 0);
});

test('admin no puede crear el garage propio de otra empresa o sede', async () => {
    const empresaAjena = fixture({ sedeData: { ...sede, id_empresa: 20 } });
    await assert.rejects(() => empresaAjena.svc.createPropioAsync(payload, admin), { statusCode: 403 });

    const otraSede = fixture();
    await assert.rejects(() => otraSede.svc.createPropioAsync(payload, adminSede), { statusCode: 403 });
});

test('requiere dirección de sede y capacidad de reservas positiva', async () => {
    const sinDireccion = fixture({ sedeData: { ...sede, ubicacion: ' ' } });
    await assert.rejects(() => sinDireccion.svc.createPropioAsync(payload, admin), { statusCode: 409 });

    const sinCupo = fixture();
    await assert.rejects(() => sinCupo.svc.createPropioAsync({ ...payload, capacidad_reservas: 0 }, admin), { statusCode: 400 });

    const sobreLimite = fixture();
    await assert.rejects(() => sobreLimite.svc.createPropioAsync({ ...payload, capacidad_reservas: 32768 }, admin), { statusCode: 400 });

    const precioDecimal = fixture();
    await assert.rejects(() => precioDecimal.svc.createPropioAsync({ ...payload, precio_auto: 100.5 }, admin), { statusCode: 400 });
});

test('revierte el garage si no se puede crear el trato automático', async () => {
    const fx = fixture({ insertError: new Error('falló el trato') });
    await assert.rejects(() => fx.svc.createPropioAsync(payload, admin), /falló el trato/);
    assert.ok(fx.commands.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!fx.commands.some(({ sql }) => sql === 'COMMIT'));
    assert.ok(fx.commands.some(({ sql }) => sql === 'RELEASE'));
});

test('superadmin puede crear un garage propio para cualquier sede autorizada', async () => {
    const fx = fixture({ sedeData: { ...sede, id_empresa: 20 } });
    const created = await fx.svc.createPropioAsync(payload, superadmin);
    assert.equal(created.id_sede_propia, 7);
});

test('la API habilita alta propia y el descubrimiento y las solicitudes excluyen garages propios', async () => {
    const [controller, garageRepo, solicitudRepo, tratoRepo] = await Promise.all([
        readFile(new URL('../src/controllers/garageController.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/repositories/garageRepository.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/repositories/solicitudEmpresaGarageRepository.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/repositories/tratoEmpresaGarageRepository.js', import.meta.url), 'utf8'),
    ]);

    assert.match(controller, /post\('\/propio', requireRole\(1, 4, ROLE_NAMES\.ADMIN, ROLE_NAMES\.SUPERADMIN\)/);
    assert.match(garageRepo, /AND g\.id_sede_propia IS NULL/);
    assert.match(solicitudRepo, /garage propio de una sede no acepta solicitudes/);
    assert.match(tratoRepo, /garage propio de una sede no admite tratos adicionales/);
});

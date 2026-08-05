import test from 'node:test';
import assert from 'node:assert/strict';
import GarageService from '../src/services/garageService.js';
import TratoEmpresaGarageService from '../src/services/tratoEmpresaGarageService.js';

const owner = { id: 50, id_rol: 99, tipo_rol: 'dueño_garage' };
const superadmin = { id: 1, id_rol: 4, tipo_rol: 'superadmin' };

function garageService() {
    const svc = new GarageService();
    const rows = new Map();
    svc.sedeService = { getByIdAsync: async () => ({ id: 1 }) };
    svc.repo = {
        createAsync: async (e) => { const row = { id: 1, ...e }; rows.set(1, row); return row; },
        getByIdAsync: async (id) => rows.get(id) ?? null,
        updateAsync: async (id, e) => { const row = { id, ...e }; rows.set(id, row); return row; },
    };
    return svc;
}

test('Garage crea, consulta y actualiza los tres precios, incluyendo cero', async () => {
    const svc = garageService();
    const base = { id_sede: 1, nombre: 'G', capacidad: 10, dias: ['Lunes'], precio_pickup: 0, precio_auto: 100, precio_moto: 50 };
    const created = await svc.createAsync(base);
    assert.deepEqual([created.precio_pickup, created.precio_auto, created.precio_moto], [0, 100, 50]);
    assert.equal((await svc.getByIdAsync(1)).precio_auto, 100);
    const updated = await svc.updateAsync(1, { precio_pickup: 25, precio_auto: 0, precio_moto: 10 });
    assert.deepEqual([updated.precio_pickup, updated.precio_auto, updated.precio_moto], [25, 0, 10]);
});

test('Garage rechaza precios negativos', async () => {
    const svc = garageService();
    await assert.rejects(() => svc.createAsync({ id_sede: 1, dias: ['Lunes'], precio_auto: -1 }), { statusCode: 400 });
});

function tratoService({ empresa = true, garage = true, capacity = 10, owned = true } = {}) {
    const svc = new TratoEmpresaGarageService();
    const rows = new Map();
    let nextId = 1;
    svc.empresaService = { getByIdAsync: async () => empresa ? ({ id: 1 }) : null };
    svc.garageService = { getByIdAsync: async () => garage ? ({ id: 2, capacidad: capacity }) : null };
    svc.usuarioGarageService = { userHasGarageAsync: async () => owned };
    svc.repo = {
        getAllAsync: async () => [...rows.values()],
        getByIdAsync: async (id) => rows.get(id) ?? null,
        getByEmpresaAsync: async (id) => [...rows.values()].filter(r => r.id_empresa === id),
        getByGarageAsync: async (id) => [...rows.values()].filter(r => r.id_garage === id),
        getByEmpresaGarageAsync: async (e, g, exclude) => [...rows.values()].find(r => r.id_empresa === e && r.id_garage === g && r.id !== exclude) ?? null,
        createAsync: async (e) => { const row = { id: nextId++, created_at: new Date().toISOString(), ...e }; rows.set(row.id, row); return row; },
        updateAsync: async (id, e) => { const row = { ...rows.get(id), ...e }; rows.set(id, row); return row; },
        deleteAsync: async (id) => rows.delete(id),
    };
    return svc;
}

const valid = { id_empresa: 1, id_garage: 2, cantidad_cocheras: 5, precio_pickup: 0, precio_auto: 20 };

test('Trato CRUD, created_at y consultas por ID, empresa y garage', async () => {
    const svc = tratoService();
    const created = await svc.createAsync(valid, owner);
    assert.ok(created.created_at);
    assert.equal((await svc.getByIdAsync(created.id, owner)).id, created.id);
    assert.equal((await svc.getByEmpresaAsync(1, owner)).length, 1);
    assert.equal((await svc.getByGarageAsync(2, owner)).length, 1);
    const updated = await svc.updateAsync(created.id, { cantidad_cocheras: 6, precio_pickup: 10, precio_auto: 0, created_at: 'forged' }, owner);
    assert.equal(updated.cantidad_cocheras, 6);
    assert.notEqual(updated.created_at, 'forged');
    assert.equal(await svc.deleteAsync(created.id, owner), true);
});

test('Trato rechaza empresa y garage inexistentes', async () => {
    await assert.rejects(() => tratoService({ empresa: false }).createAsync(valid, superadmin), /empresa no existe/i);
    await assert.rejects(() => tratoService({ garage: false }).createAsync(valid, superadmin), /garage no existe/i);
});

test('Trato valida cantidad positiva, capacidad y precios', async () => {
    const svc = tratoService({ capacity: 4 });
    await assert.rejects(() => svc.createAsync({ ...valid, cantidad_cocheras: 0 }, superadmin), /mayor que 0/i);
    await assert.rejects(() => svc.createAsync(valid, superadmin), /capacidad total/i);
    await assert.rejects(() => tratoService().createAsync({ ...valid, precio_auto: -1 }, superadmin), /precio_auto/i);
});

test('Trato rechaza duplicados', async () => {
    const svc = tratoService();
    await svc.createAsync(valid, superadmin);
    await assert.rejects(() => svc.createAsync(valid, superadmin), { statusCode: 409 });
});

test('Dueño no modifica un trato de un garage ajeno', async () => {
    const svc = tratoService();
    const created = await svc.createAsync(valid, superadmin);
    svc.usuarioGarageService.userHasGarageAsync = async () => false;
    await assert.rejects(() => svc.updateAsync(created.id, { precio_auto: 5 }, owner), { statusCode: 403 });
});

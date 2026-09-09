import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../src/database/db.js', { defaultExport: {} });
const { default: GarageService } = await import('../src/services/garageService.js');
const admin = { id: 1, id_rol: 4, tipo_rol: 'superadmin' };
const entity = { nombre: 'Centro', capacidad: 10, dias: ['Lunes'], id_dueno: 20, id_garagistas: [30, 31, 30] };

function setup({ invalidUser, failedLink } = {}) {
  const svc = new GarageService();
  const commands = [], links = [], garages = [];
  const client = {
    query: async (sql, params) => {
      commands.push(sql);
      return { rows: params?.[0] === invalidUser ? [] : [{ id: params?.[0] }] };
    },
    release: () => commands.push('RELEASE'),
  };
  svc.pool = { connect: async () => client };
  svc.repo = { createWithClientAsync: async data => { garages.push(data); return { id: 90, ...data }; } };
  svc.usuarioGarageService = { createWithClientAsync: async (id, garageId, connection) => {
    assert.equal(connection, client);
    if (id === failedLink) throw new Error('No se pudo asignar');
    links.push([id, garageId]);
  } };
  return { svc, commands, links, garages };
}

test('superadmin crea garage con dueño y varios garagistas sin duplicados', async () => {
  const { svc, commands, links, garages } = setup();
  await svc.createAsync(entity, admin);
  assert.deepEqual(links, [[20, 90], [30, 90], [31, 90]]);
  assert.equal(garages[0].id_dueno, undefined);
  assert.deepEqual(commands.slice(-2), ['COMMIT', 'RELEASE']);
});

test('se permite crear con dueño y sin garagistas', async () => {
  const { svc, links } = setup();
  await svc.createAsync({ ...entity, id_garagistas: [] }, admin);
  assert.deepEqual(links, [[20, 90]]);
});

test('usuario inexistente, eliminado o con otro rol aborta antes del alta', async () => {
  const { svc, commands, garages } = setup({ invalidUser: 30 });
  await assert.rejects(svc.createAsync(entity, admin), { statusCode: 400 });
  assert.equal(garages.length, 0);
  assert.deepEqual(commands.slice(-2), ['ROLLBACK', 'RELEASE']);
});

test('fallo al asignar personal revierte toda la transacción', async () => {
  const { svc, commands } = setup({ failedLink: 31 });
  await assert.rejects(svc.createAsync(entity, admin), /No se pudo asignar/);
  assert.ok(!commands.includes('COMMIT'));
  assert.deepEqual(commands.slice(-2), ['ROLLBACK', 'RELEASE']);
});

test('dueño no puede asignar terceros ni cambiar el propietario al crear', async () => {
  const { svc, commands } = setup();
  await assert.rejects(svc.createAsync(entity, { id: 20, tipo_rol: 'dueño_garage' }), { statusCode: 403 });
  assert.deepEqual(commands, []);
});

test('rechaza IDs inválidos y listas mal formadas', async () => {
  for (const fields of [{ id_dueno: null }, { id_dueno: '20' }, { id_garagistas: null }, { id_garagistas: [0] }, { id_garagistas: ['30'] }]) {
    const { svc, commands } = setup();
    await assert.rejects(svc.createAsync({ ...entity, ...fields }, admin), { statusCode: 400 });
    assert.deepEqual(commands, []);
  }
});

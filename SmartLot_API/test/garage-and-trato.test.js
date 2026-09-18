import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import GarageService from '../src/services/garageService.js';
import TratoEmpresaGarageService from '../src/services/tratoEmpresaGarageService.js';

const owner = { id: 50, tipo_rol: 'dueño_garage' };
const admin = { id: 10, id_rol: 1, tipo_rol: 'admin', id_empresa: 1 };
const adminSede = { ...admin, id_sede: 7 };
const superadmin = { id: 1, id_rol: 4, tipo_rol: 'superadmin' };

function garageService({ relationFails = false } = {}) {
  const svc = new GarageService();
  const commands = [];
  const client = { query: async (sql) => { commands.push(sql); }, release: () => commands.push('RELEASE') };
  svc.pool = { connect: async () => client };
  svc.repo = {
    createWithClientAsync: async (e) => ({ id: 9, ...e }),
    createAsync: async (e) => ({ id: 9, ...e }),
    getByIdAsync: async (id, user) => user?.id === 999 ? null : ({ id, capacidad: 10, dias: ['Lunes'] }),
  };
  svc.usuarioGarageService = { createWithClientAsync: async () => { if (relationFails) throw new Error('relation failed'); } };
  svc.notificacionService = { crearAsync: async () => {} };
  return { svc, commands };
}

const garage = { nombre: 'Garage', capacidad: 10, dias: ['Lunes'], precio_auto: 10, precio_moto: 5, precio_pickup: 15 };
test('dueño crea garage sin sede y queda relacionado en la misma transacción', async () => {
  const { svc, commands } = garageService();
  const created = await svc.createAsync(garage, owner);
  assert.equal(Object.hasOwn(created, 'id_sede'), false);
  assert.deepEqual(commands.slice(0, 2), ['BEGIN', 'COMMIT']);
});
test('si falla usuario_garage se revierte y no queda garage huérfano', async () => {
  const { svc, commands } = garageService({ relationFails: true });
  await assert.rejects(() => svc.createAsync(garage, owner), /relation failed/);
  assert.ok(commands.includes('ROLLBACK'));
  assert.ok(!commands.includes('COMMIT'));
});
test('dueño no obtiene un garage ajeno para modificarlo', async () => {
  const { svc } = garageService();
  assert.equal(await svc.getByIdAsync(2, { ...owner, id: 999 }), null);
});
test('dueño puede restaurar un garage eliminado y delega el usuario al repo', async () => {
  const { svc } = garageService();
  let calledWith = null;
  svc.repo.restoreAsync = async (id, user) => { calledWith = { id, user }; return { id, Borrado: false }; };
  const restored = await svc.restoreAsync(3, owner);
  assert.deepEqual(calledWith, { id: 3, user: owner });
  assert.equal(restored.Borrado, false);
});

function tratoService() {
  const svc = new TratoEmpresaGarageService();
  const rows = [];
  svc.sedeService = { getByIdAsync: async (id) => id === 99 ? ({ id, id_empresa: 2 }) : ({ id, id_empresa: id === 8 ? 2 : 1 }) };
  svc.usuarioGarageService = { userHasGarageAsync: async () => false };
  svc.notificacionService = { crearAsync: async () => {} };
  svc.repo = {
    getBySedeGarageAsync: async (s, g) => rows.find((r) => r.id_sede === s && r.id_garage === g) || null,
    createAgreementAsync: async (e) => { const row = { id: rows.length + 1, id_empresa: e.id_sede === 8 ? 2 : 1, precio_auto: 100, precio_pickup: 200, ...e }; rows.push(row); return row; },
    getByIdAsync: async (id) => rows.find((r) => r.id === id) || null,
    getByEmpresaAsync: async (e, s) => rows.filter((r) => r.id_empresa === e && (!s || r.id_sede === s)),
    getByGarageAsync: async (g) => rows.filter((r) => r.id_garage === g),
    getAllAsync: async () => rows,
    updateQuantityAsync: async (id, cantidad) => Object.assign(rows.find((r) => r.id === id), { cantidad_cocheras: cantidad }),
    softDeleteAsync: async (id) => rows.splice(rows.findIndex((r) => r.id === id), 1).length === 1,
  };
  return { svc, rows };
}

test('admin no puede crear un trato directo ni falsificando empresa o precios', async () => {
  const { svc } = tratoService();
  await assert.rejects(() => svc.createAsync({ id_empresa: 999, id_sede: 7, id_garage: 3, cantidad_cocheras: 4, precio_auto: 1 }, admin), { statusCode: 403 });
});
test('admin restringido no opera otra sede y una sede ajena a su empresa se rechaza', async () => {
  const { svc } = tratoService();
  await assert.rejects(() => svc.createAsync({ id_sede: 8, id_garage: 3, cantidad_cocheras: 1 }, adminSede), { statusCode: 403 });
  await assert.rejects(() => svc.createAsync({ id_sede: 99, id_garage: 3, cantidad_cocheras: 1 }, admin), { statusCode: 403 });
});
test('mismo garage admite sedes distintas pero no duplica sede + garage', async () => {
  const { svc } = tratoService();
  await svc.createAsync({ id_sede: 7, id_garage: 3, cantidad_cocheras: 1 }, superadmin);
  await svc.createAsync({ id_sede: 8, id_garage: 3, cantidad_cocheras: 1 }, superadmin);
  await assert.rejects(() => svc.createAsync({ id_sede: 7, id_garage: 3, cantidad_cocheras: 1 }, superadmin), { statusCode: 409 });
});
test('admin solo puede cambiar cantidad, no empresa, garage ni precio', async () => {
  const { svc } = tratoService();
  const row = await svc.createAsync({ id_sede: 7, id_garage: 3, cantidad_cocheras: 1 }, superadmin);
  const changed = await svc.updateAsync(row.id, { cantidad_cocheras: 2, id_empresa: 9, id_garage: 9, precio_auto: 1 }, admin);
  assert.deepEqual([changed.cantidad_cocheras, changed.id_empresa, changed.id_garage, changed.precio_auto], [2, 1, 3, 100]);
});

const controller = await readFile(new URL('../src/controllers/garageController.js', import.meta.url), 'utf8');
const repository = await readFile(new URL('../src/repositories/garageRepository.js', import.meta.url), 'utf8');
const tratoRepo = await readFile(new URL('../src/repositories/tratoEmpresaGarageRepository.js', import.meta.url), 'utf8');
const tratoController = await readFile(new URL('../src/controllers/tratoEmpresaGarageController.js', import.meta.url), 'utf8');
test('admin no puede crear, editar ni eliminar garage físico y cercanos está antes de /:id', () => {
  assert.match(controller, /post\('', requireRole\(4, ROLE_NAMES\.DUENO_GARAGE/);
  assert.match(controller, /put\('\/:id', requireRole\(4, ROLE_NAMES\.DUENO_GARAGE/);
  assert.ok(controller.indexOf("get('/cercanos'") < controller.indexOf("get('/:id'"));
});
test('dueño de garage puede restaurar con la misma restricción de rol que eliminar', () => {
  assert.match(controller, /patch\('\/:id\/restaurar', requireRole\(4, ROLE_NAMES\.DUENO_GARAGE, ROLE_NAMES\.SUPERADMIN\)/);
  assert.match(controller, /restoreAsync\(id, req\.usuario\)/);
  assert.match(repository, /restoreAsync\s*=\s*async\s*\(id,\s*requestingUser/);
  assert.match(repository, /COALESCE\(g\."Borrado", false\) = true/);
  assert.match(repository, /RETURNING g\.\*/);
});
test('acceso normal usa usuario_garage o trato derivando empresa mediante sede', () => {
  assert.match(repository, /usuario_garage/); assert.match(repository, /trato_empresa_garage/);
  assert.match(repository.slice(0, repository.indexOf('createAsync')), /JOIN sedes ts ON ts\.id=teg\.id_sede/);
});
test('capacidad de tratos se suma bajo bloqueo de garage', () => {
  assert.match(tratoRepo, /FOR UPDATE/); assert.match(tratoRepo, /SUM\(cantidad_cocheras\)/);
});
test('cancelar trato hace soft delete y notifica al dueño', async () => {
  const { svc, rows } = tratoService();
  const notificados = [];
  svc.notificacionService = { crearAsync: async (id, mensaje, tipo) => { notificados.push({ id, tipo }); } };
  svc._obtenerActorNombre = async () => 'Admin';
  svc._obtenerDueniosGarage = async () => [{ id: 50 }];
  const row = await svc.createAsync({ id_sede: 7, id_garage: 3, cantidad_cocheras: 1 }, superadmin);
  assert.equal(await svc.cancelAsync(row.id, admin), true);
  assert.equal(rows.length, 0);
  assert.deepEqual(notificados, [{ id: 50, tipo: 'trato_cancelado' }]);
});
test('repo de tratos no borra físicamente y filtra cancelados', () => {
  assert.doesNotMatch(tratoRepo, /DELETE FROM trato_empresa_garage/);
  assert.match(tratoRepo, /SET "Borrado" = true/);
  assert.match(tratoRepo, /SET "Borrado" = true WHERE id=\$1 AND COALESCE\("Borrado", false\)=false/);
  assert.match(tratoRepo, /WHERE COALESCE\(t\."Borrado", false\) = false/);
  assert.match(tratoRepo, /AND COALESCE\("Borrado", false\)=false/);
});
test('cancelar trato expone PATCH y mantiene DELETE como alias lógico', () => {
  assert.match(tratoController, /patch\('\/:id\/cancelar'/);
  assert.match(tratoController, /svc\.cancelAsync/);
  assert.doesNotMatch(tratoController, /svc\.deleteAsync/);
});

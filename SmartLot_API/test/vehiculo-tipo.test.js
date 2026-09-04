import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import VehiculoService from '../src/services/vehiculoService.js';

const admin = { id: 10, id_rol: 1 };

const modelos = {
  1: { id: 1, nombre: 'Gol', tipo_vehiculo: 'auto' },
  75: { id: 75, nombre: 'Amarok', tipo_vehiculo: 'pickup' },
  3: { id: 3, nombre: 'YBR', tipo_vehiculo: 'moto' },
  4: { id: 4, nombre: 'Sin tipo' },
};

function vehiculoService({ modelo = null, modeloFaltante = null } = {}) {
  const svc = new VehiculoService();
  svc.usuarioService = { getByIdAsync: async (id) => id ? { id } : null };
  svc.modeloService = {
    getByIdAsync: async (id) => {
      if (modeloFaltante && id === modeloFaltante) return null;
      return modelo && modelo.id === id ? { ...modelo } : (modelos[id] ?? null);
    },
  };
  const created = [];
  svc.repo = {
    createAsync: async (e) => { const row = { id: 1, ...e }; created.push(row); return row; },
    updateAsync: async (id, e) => ({ id, ...e }),
    reactivateAsync: async (id, e) => ({ id, ...e }),
    getByPatenteIncludingDeletedAsync: async () => null,
    getByPatenteAsync: async () => null,
    getByIdAsync: async (id) => ({ id, id_usuario: 7, id_modelo: 1, patente: 'AB123CD', tipo_vehiculo: 'auto' }),
  };
  return { svc, created };
}

test('crear un auto guarda tipo_vehiculo "auto"', async () => {
  const { svc, created } = vehiculoService();
  const result = await svc.createAsync({ id_usuario: 10, id_modelo: 1, patente: 'AB123CD' }, admin);
  assert.equal(result.tipo_vehiculo, 'auto');
  assert.equal(created[0].tipo_vehiculo, 'auto');
});

test('crear una pickup guarda tipo_vehiculo "pickup"', async () => {
  const { svc, created } = vehiculoService();
  const result = await svc.createAsync({ id_usuario: 10, id_modelo: 75, patente: 'AB123CD' }, admin);
  assert.equal(result.tipo_vehiculo, 'pickup');
  assert.equal(created[0].tipo_vehiculo, 'pickup');
});

test('crear una moto guarda tipo_vehiculo "moto"', async () => {
  const { svc, created } = vehiculoService();
  const result = await svc.createAsync({ id_usuario: 10, id_modelo: 3, patente: 'AB123CD' }, admin);
  assert.equal(result.tipo_vehiculo, 'moto');
  assert.equal(created[0].tipo_vehiculo, 'moto');
});

test('un tipo_vehiculo enviado manualmente se ignora y se usa el del modelo', async () => {
  const { svc, created } = vehiculoService();
  const result = await svc.createAsync(
    { id_usuario: 10, id_modelo: 75, patente: 'AB123CD', tipo_vehiculo: 'moto' },
    admin
  );
  assert.equal(result.tipo_vehiculo, 'pickup');
  assert.equal(created[0].tipo_vehiculo, 'pickup');
});

test('crear con id_modelo inexistente falla y no crea el vehículo', async () => {
  const { svc, created } = vehiculoService({ modeloFaltante: 999 });
  await assert.rejects(
    () => svc.createAsync({ id_usuario: 10, id_modelo: 999, patente: 'AB123CD' }, admin),
    { statusCode: 400 }
  );
  assert.equal(created.length, 0);
});

test('crear con modelo sin tipo_vehiculo falla y no crea el vehículo', async () => {
  const { svc, created } = vehiculoService();
  await assert.rejects(
    () => svc.createAsync({ id_usuario: 10, id_modelo: 4, patente: 'AB123CD' }, admin),
    { statusCode: 400 }
  );
  assert.equal(created.length, 0);
});

test('cambiar el modelo de un vehículo recalcula su tipo_vehiculo', async () => {
  const { svc } = vehiculoService();
  const result = await svc.updateAsync(
    1,
    { id_usuario: 10, id_modelo: 75, patente: 'ZZ999ZZ', tipo_vehiculo: 'auto' },
    admin
  );
  assert.equal(result.tipo_vehiculo, 'pickup');
});

test('modificar solo tipo_vehiculo sin cambiar el modelo no lo modifica', async () => {
  const { svc } = vehiculoService();
  const result = await svc.updateAsync(
    1,
    { tipo_vehiculo: 'moto', id_modelo: 1 },
    admin
  );
  assert.equal(result.tipo_vehiculo, 'auto');
});

test('modificar solo tipo_vehiculo sin id_modelo no genera inconsistencia', async () => {
  const { svc } = vehiculoService();
  const result = await svc.updateAsync(1, { tipo_vehiculo: 'moto' }, admin);
  assert.equal(Object.hasOwn(result, 'tipo_vehiculo'), false);
});

const repository = await readFile(new URL('../src/repositories/vehiculoRepository.js', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../src/services/vehiculoService.js', import.meta.url), 'utf8');
const entity = await readFile(new URL('../src/entities/Vehiculo.js', import.meta.url), 'utf8');

test('el repositorio persiste tipo_vehiculo en insert, update y reactivación', () => {
  assert.match(repository, /INSERT INTO vehiculos \(id_usuario, id_modelo, patente, tipo_vehiculo\)/);
  assert.match(repository, /tipo_vehiculo = \$/);
  assert.match(repository, /tipo_vehiculo/);
});

test('el servicio deriva el tipo desde el modelo y no desde el frontend', () => {
  assert.match(serviceSource, /delete entity\.tipo_vehiculo/);
  assert.match(serviceSource, /_asignarTipoVehiculoSegunModelo/);
  assert.match(serviceSource, /modelo\?\.tipo_vehiculo/);
});

test('la entidad Vehiculo expone el campo tipo_vehiculo', () => {
  assert.match(entity, /\btipo_vehiculo\b/);
});

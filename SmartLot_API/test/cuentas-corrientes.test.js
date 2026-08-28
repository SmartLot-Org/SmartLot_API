import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import CuentaCorrienteService from '../src/services/cuentaCorrienteService.js';

const admin = { id: 10, id_rol: 1, id_empresa: 5 };
const rows = [
  { id: '1', id_reserva: 138, id_garage: 26, garage: 'Garage Caballito Test', id_sede: 4, sede: 'Sede UNO', periodo: '2026-08', fecha_inicio: '2026-08-03T11:00:00Z', fecha_fin: '2026-08-03T12:00:00Z', tipo_vehiculo: 'auto', minutos_facturados: 60, tarifa_hora_aplicada: '3200.00', importe_generado: '3200.00' },
  { id: '2', id_reserva: 139, id_garage: 26, garage: 'Garage Caballito Test', id_sede: 4, sede: 'Sede UNO', periodo: '2026-08', fecha_inicio: '2026-08-04T12:00:00Z', fecha_fin: '2026-08-04T13:30:00Z', tipo_vehiculo: 'auto', minutos_facturados: 90, tarifa_hora_aplicada: '3200.00', importe_generado: '4800.00' },
];

const fixture = (data = rows) => {
  const service = new CuentaCorrienteService();
  let received;
  service.repo = { getAdminAsync: async (filters) => { received = filters; return data; } };
  return { service, getReceived: () => received };
};

test('agrupa consumos reales y calcula el proporcional de 90 minutos', async () => {
  const { service } = fixture();
  const result = await service.getAdminAsync({ periodo: '2026-08' }, admin);
  assert.deepEqual(result.summary, { reservasUtilizadas: 2, minutosTotales: 150, importeGenerado: 8000 });
  assert.equal(result.items[0].movimientos[1].importeGenerado, 4800);
});

test('un periodo vacío devuelve items y totales en cero', async () => {
  const { service } = fixture([]);
  assert.deepEqual(await service.getAdminAsync({ periodo: '2026-09' }, admin), {
    items: [], summary: { reservasUtilizadas: 0, minutosTotales: 0, importeGenerado: 0 },
  });
});

test('empresa siempre sale de la sesión y un admin de sede no puede cambiarla', async () => {
  const { service, getReceived } = fixture([]);
  await service.getAdminAsync({ id_empresa: '999', id_sede: '4', search: 'Caballito' }, { ...admin, id_sede: 4 });
  assert.equal(getReceived().idEmpresa, 5);
  await assert.rejects(() => service.getAdminAsync({ id_sede: '8' }, { ...admin, id_sede: 4 }), { statusCode: 403 });
});

test('rechaza filtros inválidos', async () => {
  const { service } = fixture([]);
  await assert.rejects(() => service.getAdminAsync({ periodo: '2026-13' }, admin), { statusCode: 400 });
  await assert.rejects(() => service.getAdminAsync({ id_sede: 'abc' }, admin), { statusCode: 400 });
});

test('dueño agrupa por empresa y el repositorio recibe exclusivamente su usuario autenticado', async () => {
  const service = new CuentaCorrienteService();
  let received;
  service.repo = { getDuenoAsync: async (filters) => { received = filters; return [{ ...rows[0], id_empresa: 5, empresa: 'SmartLot' }]; } };
  const result = await service.getDuenoAsync({ periodo: '2026-08', id_garage: '26', id_usuario: '999' }, { id: 30, tipo_rol: 'dueño_garage' });
  assert.equal(received.idUsuario, 30);
  assert.equal(result.items[0].empresa, 'SmartLot');
  assert.deepEqual(result.summary, { reservasUtilizadas: 1, minutosTotales: 60, importeGenerado: 3200 });
});

const repositorySource = await readFile(new URL('../src/repositories/cuentaCorrienteRepository.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../src/controllers/cuentaCorrienteController.js', import.meta.url), 'utf8');
test('la creación exige reserva completa, usa tipo explícito y es idempotente', () => {
  assert.match(repositorySource, /r\.entro = true[\s\S]*r\.salio = true[\s\S]*COALESCE\(r\."Borrado", false\) = false/);
  assert.match(repositorySource, /CASE v\.tipo_vehiculo::text[\s\S]*precio_auto[\s\S]*precio_moto[\s\S]*precio_pickup/);
  assert.match(repositorySource, /ON CONFLICT \(id_reserva\) DO NOTHING/);
  assert.match(repositorySource, /ROUND\(tarifa_hora_aplicada \* minutos_facturados \/ 60\.0, 2\)/);
  assert.match(repositorySource, /EXISTS \([\s\S]*FROM usuario_garage ug[\s\S]*ug\.id_usuario = \$1[\s\S]*ug\.id_garage = c\.id_garage/);
});

test('endpoint de dueño acepta el ID histórico 5 además del nombre del rol', () => {
  assert.match(controllerSource, /requireRole\(5, ROLE_NAMES\.DUENO_GARAGE\)/);
});

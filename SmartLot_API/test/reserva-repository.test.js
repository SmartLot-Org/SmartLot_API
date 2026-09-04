import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const queries = [];

const client = {
  async query(sql, params = []) {
    queries.push({ sql, params });

    if (queries.length === 1) return { rowCount: 0, rows: [] };
    if (sql.includes('FROM usuarios')) {
      return { rowCount: 1, rows: [{ id: 7, id_sede: 3, id_empresa: 2 }] };
    }
    if (sql.includes('FROM vehiculos')) {
      return { rowCount: 1, rows: [{ id: 11, tipo_vehiculo: 'auto' }] };
    }
    if (sql.includes('FROM garages')) {
      return { rowCount: 1, rows: [{ id: 5, capacidad: 20, estado: true }] };
    }
    if (sql.includes('FROM trato_empresa_garage')) {
      return {
        rowCount: 1,
        rows: [{ id: 13, cantidad_cocheras: 4, modalidad_pago: 'empresa_cubre_cupo', precio_auto: 100 }],
      };
    }
    if (sql.includes('COUNT(*) FILTER')) {
      return { rowCount: 1, rows: [{ trato: 0, garage: 0 }] };
    }
    if (sql.includes('SELECT 1 FROM reservas')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('INSERT INTO reservas')) {
      return { rowCount: 1, rows: [{ id: 99, estado_reserva: 'confirmada' }] };
    }

    throw new Error(`Consulta inesperada en test: ${sql}`);
  },
};

mock.module('../src/database/db.js', {
  defaultExport: { query: client.query.bind(client) },
});

const { default: ReservaRepository } = await import('../src/repositories/reservaRepository.js');

test('crea reservas sin ambigüedad entre text y estado_reserva_enum', async () => {
  queries.length = 0;
  const repo = new ReservaRepository();

  const result = await repo.quoteAndCreateWithClientAsync({
    id_usuario: 7,
    id_garage: 5,
    id_vehiculo: 11,
    fecha_entrada: '2099-01-10 09:00:00',
    fecha_salida: '2099-01-10 10:00:00',
    dia: 'Lunes',
  }, client, true);

  const insert = queries.at(-1);
  assert.equal(result.id, 99);
  assert.match(insert.sql, /\$13::estado_reserva_enum/);
  assert.match(insert.sql, /\$14/);
  assert.equal(insert.params.length, 14);
  assert.equal(insert.params[12], 'confirmada');
  assert.equal(insert.params[13], null);
  assert.doesNotMatch(insert.sql, /CASE WHEN \$13/);
});

mock.restoreAll();

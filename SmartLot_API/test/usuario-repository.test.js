import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/repositories/usuarioRepository.js', import.meta.url), 'utf8');

test('lecturas de usuarios agregan garages sin multiplicar filas', () => {
  assert.equal((source.match(/LEFT JOIN LATERAL/g) || []).length, 3);
  assert.equal((source.match(/ARRAY_AGG\(DISTINCT ug\.id_garage ORDER BY ug\.id_garage\)/g) || []).length, 3);
  assert.doesNotMatch(source, /LEFT JOIN usuario_garage ug ON u\.id = ug\.id_usuario/);
});

test('id_garage escalar es deterministico y se conserva id_garages', () => {
  assert.equal((source.match(/MIN\(ug\.id_garage\) AS id_garage/g) || []).length, 3);
  assert.match(source, /AS id_garages/);
});

test('getById y getByEmail siguen parametrizados y getAll conserva tenant', () => {
  assert.match(source, /getTenantCondition\(requestingUser, 1/);
  assert.match(source, /WHERE u\.id = \$1/);
  assert.match(source, /WHERE u\.email = \$1/);
});

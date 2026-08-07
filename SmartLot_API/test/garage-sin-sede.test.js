import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('la entidad y las escrituras de garages no dependen de id_sede', async () => {
  const [entity, repository] = await Promise.all([
    read('../src/entities/Garage.js'),
    read('../src/repositories/garageRepository.js'),
  ]);

  assert.doesNotMatch(entity, /\bid_sede\b/);
  const writes = repository.match(/(?:INSERT INTO garages|UPDATE garages SET)[\s\S]*?(?:RETURNING \*|`)/g) ?? [];
  assert.ok(writes.length >= 3);
  for (const statement of writes) assert.doesNotMatch(statement, /\bid_sede\b/);
});

test('el controller ignora id_sede en altas y ediciones y exige una sede de referencia para distancia', async () => {
  const controller = await read('../src/controllers/garageController.js');
  const createAndUpdate = controller.slice(controller.indexOf('// CREATE (POST)'), controller.indexOf('// GET DIAS BY GARAGE ID'));

  assert.doesNotMatch(createAndUpdate, /\bid_sede\b/);
  assert.match(controller, /req\.query\.sede_id \?\? req\.usuario\?\.id_sede/);
  assert.match(controller, /sedeService\.getByIdAsync\(sedeId, req\.usuario\)/);
  assert.doesNotMatch(controller, /garage\.id_sede/);
});

test('la migracion local elimina solo la FK y la columna sin CASCADE ni borrado', async () => {
  const migration = await read('../migrations/20260807_001_remove_id_sede_from_garages.sql');

  assert.match(migration, /DROP CONSTRAINT IF EXISTS garages_id_sede_fkey/i);
  assert.match(migration, /DROP COLUMN IF EXISTS id_sede/i);
  assert.doesNotMatch(migration, /CASCADE|DELETE FROM|TRUNCATE/i);
});

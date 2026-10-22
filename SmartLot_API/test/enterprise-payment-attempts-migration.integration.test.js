import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migracion SQL conserva pagos aceptados, libera pins no aprobados y archiva evidencia contradictoria', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE empresas(id integer PRIMARY KEY);
      CREATE TABLE sedes(id integer PRIMARY KEY);
      CREATE TABLE consumos_reserva(id bigint PRIMARY KEY);
      CREATE TABLE pagos(id uuid DEFAULT gen_random_uuid(),id_empresa integer,id_reserva integer,
        id_orden_externa text,mp_preference_id text,mp_payment_id text,mp_payment_status text,monto numeric,moneda text,metadata jsonb);
      INSERT INTO empresas VALUES(10);`);
    await db.exec(await readFile(new URL('../migrations/20261022123341_seg03_enterprise_payment_orders.sql', import.meta.url), 'utf8'));
    const fixtures = [
      { id: '900', name: 'rejected', status: 'rejected' },
      { id: '910', name: 'accepted', status: 'approved', settled: true },
      { id: '920', name: 'other-rejected-after-approved', status: 'approved', otherSnapshot: true },
      { id: '930', name: 'refunded', status: 'approved', refund: 1 },
      { id: '940', name: 'insufficient', status: 'approved', amount: 0.10 },
      { id: '950', name: 'uncorrelated-reversal', status: 'approved', poisonedPreference: true },
      { id: '960', name: 'merchant-refunded', status: 'approved', refund: 1, merchant: true }
    ];
    const originals = new Map();
    for (const fixture of fixtures) {
      const reference = fixture.name;
      const preference = `pref-${reference}`;
      const summary = { id: fixture.id, external_reference: reference, preference_id: preference,
        status: fixture.status, transaction_amount: fixture.amount ?? 120.15, currency_id: 'ARS', transaction_amount_refunded: fixture.refund || 0 };
      if (fixture.merchant) {
        delete summary.preference_id;
        summary.order = { id: 'merchant-960' };
      }
      const snapshot = fixture.otherSnapshot ? { ...summary, id: '921', status: 'rejected' } : summary;
      const reversal = fixture.otherSnapshot ? { ...snapshot, status: 'charged_back' }
        : fixture.poisonedPreference ? { ...summary, preference_id: 'other', transaction_amount_refunded: 1 }
          : fixture.refund ? summary : null;
      await db.query(`INSERT INTO enterprise_payment_orders(reference,id_empresa,expected_amount,currency,preference_id,payment_id,settled,provider_snapshot,reversal_snapshot)
        VALUES($1,10,120.15,'ARS',$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [reference, preference, fixture.id, Boolean(fixture.settled), JSON.stringify(snapshot), JSON.stringify(reversal)]);
      await db.query(`INSERT INTO pagos(id_empresa,id_orden_externa,mp_preference_id,mp_payment_id,mp_payment_status,monto,moneda,metadata)
        VALUES(10,$1,$2,$3,$4,120.15,'ARS',$5::jsonb)`,
      [reference, preference, fixture.id, fixture.refund ? 'partially_refunded' : fixture.status, JSON.stringify({ _mp_payment_summary: summary })]);
      originals.set(reference, { provider_snapshot: snapshot, reversal_snapshot: reversal, settled: Boolean(fixture.settled), review_reason: null });
    }
    await db.exec(await readFile(new URL('../migrations/20261022130158_seg03_enterprise_payment_attempts.sql', import.meta.url), 'utf8'));
    const migrated = (await db.query('SELECT * FROM enterprise_payment_orders')).rows;
    for (const row of migrated) {
      const fixture = fixtures.find(f => f.name === row.reference);
      assert.equal(row.expected_amount, '120.15');
      assert.equal(row.payment_id, fixture.id);
      assert.equal(row.accepted_payment_id, ['rejected', 'insufficient'].includes(row.reference) ? null : fixture.id);
      assert.equal(row.settled, Boolean(fixture.settled));
      const archived = (await db.query('SELECT legacy_evidence FROM enterprise_payment_attempts WHERE reference=$1', [row.reference])).rows[0];
      assert.deepEqual(archived.legacy_evidence, originals.get(row.reference));
      if (fixture.refund) assert.equal(row.reversal_snapshot.transaction_amount_refunded, 1);
      else assert.equal(row.reversal_snapshot, null);
    }
    // Un pin rechazado es reemplazable; el pago ya aceptado es inmutable.
    await db.query("UPDATE enterprise_payment_orders SET payment_id='901',accepted_payment_id='901' WHERE reference='rejected'");
    await assert.rejects(db.query("UPDATE enterprise_payment_orders SET payment_id='911',accepted_payment_id='911' WHERE reference='accepted'"));
    await assert.rejects(db.query('UPDATE enterprise_payment_orders SET expected_amount=0.10'));
    assert.equal((await db.query('SELECT count(*) FROM pagos')).rows[0].count, fixtures.length);
  } finally { await db.close(); }
});

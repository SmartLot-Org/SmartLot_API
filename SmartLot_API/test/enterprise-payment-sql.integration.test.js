import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';

const db = new PGlite();
let tail = Promise.resolve();
let calls = [];
let provider = {};
let holdProvider;
const pool = {
  query: (sql, params) => db.query(sql, params),
  connect: async () => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    return { query: (sql, params) => db.query(sql, params), release };
  }
};
mock.module('../src/database/db.js', { defaultExport: pool });
mock.module('../src/services/mpService.js', { namedExports: {
  createPreference: async (items, reference) => {
    calls.push({ items, reference });
    if (holdProvider === 'fail') throw new Error('provider_timeout');
    if (holdProvider) await holdProvider;
    return { id: `pref-${reference}`, init_point: 'https://checkout.test', sandbox_init_point: 'https://sandbox.test' };
  },
  refundPayment: async () => { throw new Error("No debe reembolsar en estas pruebas"); },
  getPayment: async () => structuredClone(provider),
  getMerchantOrder: async () => provider.merchantOrder || null,
  searchPayments: async () => ({ results: [structuredClone(provider)] }),
  isSandbox: () => true,
  verifySignature: () => true
} });
const { createEnterprisePreference, syncEnterprisePayment } = await import('../src/services/enterprisePaymentService.js');
const { default: Controller } = await import('../src/controllers/paymentController.js');
const { default: AccountService } = await import('../src/services/cuentaCorrienteService.js');
const { getAuthorizedPayment, listAuthorizedPayments } = await import('../src/services/paymentReadService.js');
const admin = { id: 1, id_rol: 1, id_empresa: 10, id_sede: null };
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.usuario = req.headers.actor ? JSON.parse(req.headers.actor) : admin; next(); });
app.use(Controller);
app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
const account = () => new AccountService().getAdminAsync({}, admin);
const approved = order => ({ id: '900', status: 'approved', transaction_amount: order.amount, currency_id: 'ARS', transaction_amount_refunded: 0, external_reference: order.orderId, preference_id: order.preferenceId });

test.before(async () => {
  await db.exec(`
    CREATE TABLE empresas(id integer PRIMARY KEY);
    CREATE TABLE sedes(id integer PRIMARY KEY,id_empresa integer,nombre text);
    CREATE TABLE garages(id integer PRIMARY KEY,nombre text);
    CREATE TABLE usuarios(id integer PRIMARY KEY,id_empresa integer);
    CREATE TABLE trato_empresa_garage(id integer PRIMARY KEY,id_sede integer,tarifa numeric);
    CREATE TABLE reservas(id integer PRIMARY KEY,id_usuario integer,id_trato integer,
      estado_reserva text DEFAULT 'pendiente_pago',responsable_pago text DEFAULT 'empleado',
      retencion_pago_hasta timestamptz DEFAULT '2100-01-01',importe_estimado numeric DEFAULT 80);
    CREATE TABLE consumos_reserva(id bigint PRIMARY KEY,id_reserva integer,id_empresa integer,id_sede integer,id_garage integer,
      responsable_pago text,importe_generado numeric(12,2),fecha_inicio timestamp,fecha_fin timestamp,tipo_vehiculo text,
      minutos_facturados integer,tarifa_hora_aplicada numeric);
    CREATE TABLE pagos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_reserva integer,id_empresa integer,id_orden_externa varchar(100),
      mp_preference_id varchar(100) UNIQUE,mp_payment_id varchar(100) UNIQUE,mp_payment_status text DEFAULT 'pending',mp_payment_type text,
      monto numeric(12,2),moneda text,descripcion text,fecha_aprobacion timestamptz,fecha_creacion timestamptz DEFAULT now(),fecha_actualizacion timestamptz,
      metadata jsonb DEFAULT '{}');
    CREATE TABLE webhook_eventos(id uuid DEFAULT gen_random_uuid(),mp_event_id text UNIQUE,tipo_evento text,mp_payment_id text,payload jsonb,
      firma_valida boolean,procesado boolean,fecha_procesamiento timestamptz,error_procesamiento text);
    INSERT INTO empresas VALUES(10),(20);
    INSERT INTO sedes VALUES(101,10,'A'),(102,10,'B'),(201,20,'C');
    INSERT INTO garages VALUES(1,'Garage');
    INSERT INTO usuarios VALUES(1,10),(2,10);
    INSERT INTO trato_empresa_garage VALUES(1,101,90000);
  `);
  await db.exec(await readFile(new URL('../migrations/20261022123341_seg03_enterprise_payment_orders.sql', import.meta.url), 'utf8'));
});
test.beforeEach(async () => {
  calls = []; holdProvider = null;
  await db.exec(`TRUNCATE enterprise_payment_consumptions,enterprise_payment_orders,pagos,consumos_reserva,reservas CASCADE;
    INSERT INTO reservas VALUES(1,2,1),(2,2,1),(3,2,1),(4,2,1),(5,2,1),(6,2,1);
    INSERT INTO consumos_reserva(id,id_reserva,id_empresa,id_sede,id_garage,responsable_pago,importe_generado,fecha_inicio,fecha_fin,minutos_facturados,tarifa_hora_aplicada) VALUES
    (1,1,10,101,1,'empresa',120.15,'2026-10-01','2026-10-02',60,120.15),
    (2,2,10,101,1,'empresa',30.25,'2026-10-01','2026-10-02',60,30.25),
    (3,3,10,102,1,'empresa',50,'2026-10-01','2026-10-02',60,50),
    (4,4,20,201,1,'empresa',50,'2026-10-01','2026-10-02',60,50),
    (5,5,10,101,1,'empleado',80,'2026-10-01','2026-10-02',60,80),
    (6,6,10,101,1,'empresa',0,'2026-10-01','2026-10-02',60,0);
  `);
});
test.after(() => db.close());

test('SQL real: importe historico exacto, duplicados, sandbox y campos manipulados', async () => {
  const res = await request(app).post('/preference').send({ consumosIds: [1,2,1], unit_price: .10, items: [{unit_price:.10}], orderId:'ADMIN-PAGO-X', test:true, metadata: {consumos_ids:[4],importe_original:.10} });
  assert.equal(res.status,201);
  assert.equal(res.body.amount,150.40);
  assert.equal(calls[0].items[0].unit_price,150.40);
  assert.match(res.body.orderId,/^EMP-/);
  assert.deepEqual(res.body.consumosIds,['1','2']);
  await db.exec('UPDATE trato_empresa_garage SET tarifa=1');
  const order = (await db.query('SELECT * FROM enterprise_payment_orders')).rows[0];
  assert.equal(order.expected_amount,'150.40');
  const afterDealChange = await createEnterprisePreference(admin,{consumosIds:[3]});
  assert.equal(afterDealChange.amount,50);
  assert.deepEqual((await db.query('SELECT consumption_id FROM enterprise_payment_consumptions ORDER BY consumption_id')).rows.map(r=>r.consumption_id),[1,2,3]);
});
for (const [name,user,selection,status] of [
  ['empresa ajena',admin,[4],403], ['inexistente',admin,[99],403], ['responsable empleado',admin,[5],403],
  ['sede ajena',{...admin,id_sede:101},[3],403], ['empleado',{...admin,id_rol:2},[1],403],
  ['dueno',{...admin,id_rol:5},[1],403], ['garagista',{...admin,id_rol:3},[1],403],
  ['superadmin sin contexto',{id:4,id_rol:4},[1],403], ['cero',admin,[6],409]
]) test(`SQL real: ${name} rechazado antes del proveedor`, async () => {
  const res = await request(app).post('/preference').set('actor',JSON.stringify(user)).send({consumosIds:selection,idEmpresa:20});
  assert.equal(res.status,status,res.text); assert.equal(calls.length,0);
});
test('admin no puede elegir empresa; superadmin requiere contexto resuelto en SQL', async () => {
  await assert.rejects(createEnterprisePreference(admin,{consumosIds:[4],idEmpresa:20}),{statusCode:403});
  const order=await createEnterprisePreference({id:4,id_rol:4},{consumosIds:[4],idEmpresa:20});
  assert.equal(order.amount,50);
});
for (const [name,patch] of [['importe',{transaction_amount:.10}],['moneda',{currency_id:'USD'}],['preferencia',{preference_id:'otra'}],['pendiente',{status:'pending'}],['rechazado',{status:'rejected'}],['contracargo',{status:'charged_back'}],['reembolso parcial',{transaction_amount_refunded:1}],['reembolso total',{transaction_amount_refunded:120.15}],['sin evidencia de reembolsos',{transaction_amount_refunded:undefined}]]) {
  test(`SQL real: ${name} no salda`,async()=>{
    const order=await createEnterprisePreference(admin,{consumosIds:[1]});
    const payment={...approved(order),...patch};
    if (payment.transaction_amount_refunded===undefined) delete payment.transaction_amount_refunded;
    await syncEnterprisePayment(payment);
    const result=await account();
    assert.equal(result.items.flatMap(g=>g.movimientos).find(m=>m.idConsumo===1).pagado,false);
    assert.equal((await db.query('SELECT expected_amount FROM enterprise_payment_orders')).rows[0].expected_amount,'120.15');
  });
}
test('webhook y sincronizacion reales repetidos solo saldan asociaciones locales y conservan expectativa',async()=>{
  const order=await createEnterprisePreference(admin,{consumosIds:[1]});
  provider={...approved(order),metadata:{consumos_ids:[2,3],id_reserva:99}};
  for (let i=0;i<2;i++) assert.equal((await request(app).post('/webhook').send({id:'evt',type:'payment.updated',data:{id:'900'}})).status,200);
  await getAuthorizedPayment(admin,'900');
  await listAuthorizedPayments(admin,{external_reference:order.orderId});
  await db.exec(`INSERT INTO reservas VALUES(7,2,1); INSERT INTO consumos_reserva(id,id_reserva,id_empresa,id_sede,id_garage,responsable_pago,importe_generado,fecha_inicio) VALUES(7,7,10,101,1,'empresa',20,'2026-10-02')`);
  const movements=(await account()).items.flatMap(g=>g.movimientos);
  assert.deepEqual(movements.filter(m=>m.pagado).map(m=>m.idConsumo),[1]);
  assert.equal(movements.find(m=>m.idConsumo===7).pagado,false);
  assert.equal((await db.query('SELECT count(*) FROM pagos')).rows[0].count,1);
  assert.deepEqual((await db.query('SELECT metadata FROM pagos')).rows[0].metadata.consumos_ids,['1']);
  await assert.rejects(createEnterprisePreference(admin,{consumosIds:[1]}),{statusCode:409});
  assert.equal(calls.length,1);
  const second=await createEnterprisePreference(admin,{consumosIds:[1,2]});
  assert.equal(second.amount,30.25);
});
test('SQL real: dos solicitudes simultaneas no generan dos preferencias',async()=>{
  let release;
  holdProvider=new Promise(resolve=>{release=resolve;});
  const first=createEnterprisePreference(admin,{consumosIds:[1,2]});
  while (!calls.length) await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(createEnterprisePreference(admin,{consumosIds:[2]}),{statusCode:409});
  release(); await first;
  assert.equal(calls.length,1);
  assert.equal((await db.query('SELECT count(*) FROM enterprise_payment_orders')).rows[0].count,1);
});
test('SQL real: historicos de diez centavos y metadata ambigua no saldan grupos',async()=>{
  await db.exec(`INSERT INTO pagos(id_empresa,id_orden_externa,monto,moneda,mp_payment_status,metadata) VALUES(10,'ADMIN-PAGO-2026-10-G1-S101-TEST',0.10,'ARS','approved','{"consumos_ids":[1,2]}')`);
  assert.equal((await account()).items.flatMap(g=>g.movimientos).some(m=>m.pagado),false);
  assert.equal((await db.query('SELECT reason FROM enterprise_payments_pending_regularization')).rows[0].reason,'legacy_without_verified_consumptions');
});
test('reembolso posterior reabre saldo sin repartir devolucion y bloquea nuevo cobro',async()=>{
  const order=await createEnterprisePreference(admin,{consumosIds:[1,2]});
  await syncEnterprisePayment(approved(order));
  await syncEnterprisePayment({...approved(order),transaction_amount_refunded:1});
  assert.equal((await account()).items.flatMap(g=>g.movimientos).some(m=>m.pagado),false);
  await assert.rejects(createEnterprisePreference(admin,{consumosIds:[1]}),{statusCode:409});
});

test('empleado conserva pago propio con importe del servidor y sin flags economicos del browser',async()=>{
  const res=await request(app).post('/preference').set('actor',JSON.stringify({id:2,id_rol:2,id_empresa:10})).send({idReserva:6,items:[{unit_price:.10}],test:true,metadata:{id_reserva:1}});
  assert.equal(res.status,201,res.text);
  assert.equal(calls[0].items[0].unit_price,80);
  assert.equal((await db.query('SELECT id_reserva FROM pagos')).rows[0].id_reserva,6);
});
test('endpoint anterior autenticado tampoco acepta items arbitrarios',async()=>{
  const res=await request(app).post('/preference').send({items:[{unit_price:.10}],orderId:'ADMIN-PAGO-X'});
  assert.equal(res.status,400); assert.equal(calls.length,0);
});
test('SQL impide reescribir expectativa, preferencia o asociaciones y conserva evidencia de reembolso',async()=>{
  const order=await createEnterprisePreference(admin,{consumosIds:[1]});
  await assert.rejects(db.query('UPDATE enterprise_payment_orders SET expected_amount=0.10'));
  await assert.rejects(db.query("UPDATE enterprise_payment_orders SET preference_id='otra'"));
  await assert.rejects(db.query('UPDATE enterprise_payment_consumptions SET consumption_id=2'));
  await syncEnterprisePayment({...approved(order),transaction_amount_refunded:1});
  await syncEnterprisePayment(approved(order));
  await syncEnterprisePayment(approved(order));
  const row=(await db.query('SELECT * FROM enterprise_payment_orders')).rows[0];
  assert.equal(row.settled,false);
  assert.equal(row.reversal_snapshot.transaction_amount_refunded,1);
});
test('merchant order correlaciona preferencia ausente y rechaza una orden ajena',async()=>{
  const order=await createEnterprisePreference(admin,{consumosIds:[1]});
  provider={...approved(order),preference_id:undefined,order:{id:10},merchantOrder:{preference_id:order.preferenceId,external_reference:order.orderId,payments:[{id:'900'}]}};
  await syncEnterprisePayment(provider);
  assert.equal((await db.query('SELECT settled FROM enterprise_payment_orders')).rows[0].settled,true);
  provider.merchantOrder.preference_id='otra';
  await syncEnterprisePayment(provider);
  assert.equal((await db.query('SELECT settled FROM enterprise_payment_orders')).rows[0].settled,false);
});

test('reembolso manual previo impide cerrar con una respuesta vieja approved',async()=>{
  const order=await createEnterprisePreference(admin,{consumosIds:[1]});
  await syncEnterprisePayment(approved(order));
  await db.exec(`UPDATE pagos SET mp_payment_status='partially_refunded',metadata=metadata || '{"lastRefundId":"r-1"}'::jsonb`);
  assert.equal((await account()).items.flatMap(g=>g.movimientos).some(m=>m.pagado),false);
  await syncEnterprisePayment(approved(order));
  assert.equal((await db.query('SELECT settled FROM enterprise_payment_orders')).rows[0].settled,false);
});

test('timeout del proveedor conserva orden y claims y no permite otra preferencia',async()=>{
  holdProvider='fail';
  await assert.rejects(createEnterprisePreference(admin,{consumosIds:[1]}),/provider_timeout/);
  holdProvider=null;
  await assert.rejects(createEnterprisePreference(admin,{consumosIds:[1]}),{statusCode:409});
  assert.equal(calls.length,1);
  assert.equal((await db.query('SELECT count(*) FROM enterprise_payment_consumptions')).rows[0].count,1);
});

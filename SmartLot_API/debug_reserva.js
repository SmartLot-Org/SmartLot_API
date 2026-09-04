import pool from './src/database/db.js';
async function q(){
  try{
    const v = await pool.query(`SELECT id, patente, id_modelo, tipo_vehiculo FROM vehiculos WHERE COALESCE("Borrado",false)=false LIMIT 5`);
    console.log('vehiculos:', JSON.stringify(v.rows, null, 2));
    const m = await pool.query(`SELECT id, nombre, tipo_vehiculo FROM modelos WHERE COALESCE("Borrado",false)=false LIMIT 5`);
    console.log('modelos:', JSON.stringify(m.rows, null, 2));
    const nullVeh = await pool.query(`SELECT COUNT(*) as cnt FROM vehiculos WHERE tipo_vehiculo IS NULL AND COALESCE("Borrado",false)=false`);
    console.log('vehiculos con tipo null:', nullVeh.rows[0]);
    const allVeh = await pool.query(`SELECT COUNT(*) as cnt FROM vehiculos WHERE COALESCE("Borrado",false)=false`);
    console.log('total vehiculos:', allVeh.rows[0]);
    // check reservas columns
    const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='reservas'`);
    console.log('reservas columns:', cols.rows.map(r=>r.column_name).join(', '));
    // check trato
    const tratos = await pool.query(`SELECT id, id_sede, id_garage, modalidad_pago, cantidad_cocheras FROM trato_empresa_garage LIMIT 3`);
    console.log('tratos:', JSON.stringify(tratos.rows, null, 2));
    // check user
    const users = await pool.query(`SELECT id, id_sede, id_empresa, id_rol FROM usuarios WHERE COALESCE("Borrado",false)=false LIMIT 3`);
    console.log('users sample:', JSON.stringify(users.rows, null, 2));

  } catch(e){ console.error('ERR', e); }
  process.exit(0);
}
q();

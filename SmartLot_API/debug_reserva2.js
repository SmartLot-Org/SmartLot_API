import pool from './src/database/db.js';
async function q(){
  const userId = 99;
  const veh = await pool.query(`SELECT id, patente, id_modelo, tipo_vehiculo FROM vehiculos WHERE id_usuario=$1 AND COALESCE("Borrado",false)=false LIMIT 5`, [userId]);
  console.log('vehiculos user 99:', JSON.stringify(veh.rows, null,2));
  const user = await pool.query(`SELECT id, id_sede, id_empresa FROM usuarios WHERE id=$1`, [userId]);
  console.log('user', user.rows[0]);
  const garage = await pool.query(`SELECT id, nombre, capacidad, estado FROM garages WHERE id=26`);
  console.log('garage 26', garage.rows[0]);
  const trato = await pool.query(`SELECT * FROM trato_empresa_garage WHERE id_sede=4 AND id_garage=26`);
  console.log('trato 4-26', trato.rows[0]);
  // try to test quote
  const ReservaRepository = (await import('./src/repositories/reservaRepository.js')).default;
  const repo = new ReservaRepository();
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const future = new Date(Date.now() + 2*60*60*1000);
    const futureEnd = new Date(Date.now() + 3*60*60*1000);
    // ensure dia matches future date
    const dias = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
    const dia = dias[future.getDay()];
    console.log('trying reserva for dia', dia, 'fecha', future.toISOString(), futureEnd.toISOString());
    const entity = {
      id_usuario: userId,
      id_garage: 26,
      id_vehiculo: veh.rows[0]?.id,
      fecha_entrada: future.toISOString(),
      fecha_salida: futureEnd.toISOString(),
      dia
    };
    console.log('entity', entity);
    const quote = await repo.quoteAndCreateWithClientAsync(entity, client, false);
    console.log('quote result', quote);
    await client.query('ROLLBACK');
  }catch(e){
    console.error('quote error', e.message, 'status', e.statusCode, e);
    try{ await client.query('ROLLBACK')}catch{}
  } finally{ client.release(); }
  process.exit(0);
}
q();

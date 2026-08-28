import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();  
const { Pool } = pg;

function resolveSsl() {
  const url = process.env.DATABASE_URL || '';
  if (url.includes('sslmode=disable')) return false;
  // Supabase pooler (aws-*.pooler.supabase.com) usa cert que Node no valida
  // con rejectUnauthorized:true -> SELF_SIGNED_CERT_IN_CHAIN. Docs de Supabase
  // recomiendan require + rejectUnauthorized:false para pooler.
  // Si se provee DB_CA_CERT, usar validación estricta.
  if (process.env.DB_CA_CERT) {
    return { ca: process.env.DB_CA_CERT, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(),
});
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error adquiriendo el cliente', err.stack);
  }
  console.log('Conexión exitosa a Supabase');
  release();
});

export default pool;
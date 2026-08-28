// dbClient.js
// Expone el pool de conexiones con export nombrado para poder mockearlo
// en los tests (mock.module de Node falla con módulos que usan export default).
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

function resolveSsl() {
  const url = process.env.DATABASE_URL || '';
  if (url.includes('sslmode=disable')) return false;
  if (process.env.DB_CA_CERT) {
    return { ca: process.env.DB_CA_CERT, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const poolInstance = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(),
});

poolInstance.connect((err, client, release) => {
  if (err) {
    return console.error('Error adquiriendo el cliente', err.stack);
  }
  console.log('Conexión exitosa a Supabase');
  release();
});

export const pool = poolInstance;
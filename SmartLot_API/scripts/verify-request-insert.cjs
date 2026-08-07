require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
});

(async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            INSERT INTO solicitudes (id_sede, id_garage, descripcion, cantidad_cocheras, estado)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [5, 21, 'verificacion rollback', 1, 'pendiente']);
        console.log('Inserción válida:', JSON.stringify(result.rows[0]));
        await client.query('ROLLBACK');
        console.log('Rollback realizado; no se conservaron datos.');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error(JSON.stringify({ message: error.message, code: error.code, detail: error.detail, constraint: error.constraint }));
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})();

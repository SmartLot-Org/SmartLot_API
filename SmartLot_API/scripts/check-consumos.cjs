require('dotenv').config();
const { Pool } = require('pg');

async function main() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    });
    try {
        const result = await pool.query(
            `SELECT r.id
               FROM reservas r
              WHERE r.entro = true AND r.salio = true
                AND COALESCE(r."Borrado", false) = false
                AND NOT EXISTS (SELECT 1 FROM consumos_reserva c WHERE c.id_reserva = r.id)
              ORDER BY r.id`
        );
        if (result.rows.length) {
            console.error(`BACKFILL_REQUERIDO: ${result.rows.length} reservas completas sin consumo: ${result.rows.map((r) => r.id).join(', ')}`);
            process.exitCode = 1;
        } else {
            console.log('OK: no hay reservas completas pendientes de backfill.');
        }
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error('No se pudo verificar el backfill:', error.message);
    process.exitCode = 1;
});

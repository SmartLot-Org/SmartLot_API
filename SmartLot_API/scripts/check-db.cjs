/**
 * check-db.js
 * Testea la conexión a la base de datos y verifica que las tablas principales existan.
 */
const { Pool } = require('pg');

async function run() {
    const errors = [];
    const warnings = [];
    const details = {};

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        errors.push('DATABASE_URL no está definida en las variables de entorno');
        return { errors, warnings, details };
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: true }
            : { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
    });

    let client;
    try {
        client = await pool.connect();
        details.connected = true;

        const timeResult = await client.query('SELECT NOW()');
        details.serverTime = timeResult.rows[0].now;

        const tablesResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        details.tables = tablesResult.rows.map(r => r.table_name);

        const expectedTables = [
            'empresas', 'garages', 'marcas', 'modelos',
            'reservas', 'roles', 'sedes', 'usuarios', 'vehiculos',
        ];

        for (const table of expectedTables) {
            if (!details.tables.includes(table)) {
                warnings.push(`Tabla esperada no encontrada: ${table}`);
            }
        }

        const versionResult = await client.query('SELECT version()');
        details.dbVersion = versionResult.rows[0].version;

    } catch (err) {
        errors.push(`Error de conexión a la base de datos: ${err.message}`);
        details.connected = false;
    } finally {
        if (client) client.release();
        await pool.end();
    }

    return { errors, warnings, details };
}

module.exports = { run };

if (require.main === module) {
    (async () => {
        const { runStandalone } = require('./_cli-helper.cjs');
        const path = require('path');
        try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

        const start = Date.now();
        let result;
        try { result = await run(); } catch (err) {
            result = { errors: [`Excepción: ${err.message}`], warnings: [] };
        }
        const duration = Date.now() - start;

        const C = require('./_cli-helper.cjs').COLORS;
        console.log('');
        console.log(`${C.bold}${C.cyan}═══ Conexión a base de datos ═══${C.reset}`);
        console.log('');
        const ec = result.errors.length, wc = result.warnings.length;
        if (ec === 0 && wc === 0) console.log(`  ${C.green}OK${C.reset} (${duration}ms)`);
        else if (ec === 0) console.log(`  ${C.yellow}OK con advertencias${C.reset} (${duration}ms)`);
        else console.log(`  ${C.red}FALLÓ${C.reset} (${duration}ms)`);
        for (const e of result.errors) console.log(`  ${C.red}✗ ${e}${C.reset}`);
        for (const w of result.warnings) console.log(`  ${C.yellow}⚠ ${w}${C.reset}`);
        if (result.details) {
            for (const [k, v] of Object.entries(result.details)) {
                console.log(`  ${C.dim}${k}: ${Array.isArray(v) ? v.join(', ') : v}${C.reset}`);
            }
        }
        console.log('');
        process.exit(ec > 0 ? 1 : 0);
    })();
}

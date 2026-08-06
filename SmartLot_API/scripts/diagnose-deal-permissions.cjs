require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
});

const queries = [
    ['roles', 'SELECT id, tipo_rol FROM roles ORDER BY id'],
    ['owners', `
        SELECT u.id, u.email, u.id_rol, r.tipo_rol, COUNT(ug.id_garage)::int AS garages
        FROM usuarios u
        JOIN roles r ON r.id = u.id_rol
        LEFT JOIN usuario_garage ug ON ug.id_usuario = u.id
        WHERE LOWER(r.tipo_rol) LIKE '%garage%'
        GROUP BY u.id, u.email, u.id_rol, r.tipo_rol
        ORDER BY u.id
    `],
    ['admins', `
        SELECT u.id, u.email, u.id_rol, r.tipo_rol, u.id_empresa, u.id_sede
        FROM usuarios u
        JOIN roles r ON r.id = u.id_rol
        WHERE u.id_rol = 1 OR LOWER(r.tipo_rol) = 'admin'
        ORDER BY u.id
    `],
    ['companies', `
        SELECT id, nombre, COALESCE("Borrado", false) AS borrado
        FROM empresas
        ORDER BY id
    `],
    ['recent_sessions', `
        SELECT rs.usuario_id, u.email, u.id_rol, r.tipo_rol, u.id_empresa, u.id_sede,
               rs.expires_at
        FROM refresh_sessions rs
        JOIN usuarios u ON u.id = rs.usuario_id
        JOIN roles r ON r.id = u.id_rol
        ORDER BY rs.id DESC
        LIMIT 10
    `],
    ['request_columns', `
        SELECT column_name, data_type, is_nullable, column_default, is_identity, identity_generation
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'solicitudes'
        ORDER BY ordinal_position
    `],
    ['requests', `
        SELECT so.id, so.estado, so.id_garage, so.id_empresa,
               ARRAY_REMOVE(ARRAY_AGG(ug.id_usuario), NULL) AS owner_ids
        FROM solicitudes so
        LEFT JOIN usuario_garage ug ON ug.id_garage = so.id_garage
        GROUP BY so.id, so.estado, so.id_garage, so.id_empresa
        ORDER BY so.id DESC
        LIMIT 20
    `],
    ['garages', `
        SELECT g.id, g.nombre, g.id_sede, g.capacidad, g.estado,
               COALESCE(SUM(t.cantidad_cocheras), 0)::int AS comprometidas,
               ARRAY_REMOVE(ARRAY_AGG(ug.id_usuario), NULL) AS user_ids
        FROM garages g
        LEFT JOIN usuario_garage ug ON ug.id_garage = g.id
        LEFT JOIN trato_empresa_garage t ON t.id_garage = g.id
        WHERE COALESCE(g."Borrado", false) = false
        GROUP BY g.id, g.nombre, g.id_sede, g.capacidad, g.estado
        ORDER BY g.id DESC
        LIMIT 30
    `],
];

(async () => {
    for (const [name, sql] of queries) {
        const result = await pool.query(sql);
        console.log(name, JSON.stringify(result.rows));
    }
    await pool.end();
})().catch(async (error) => {
    console.error(error.message);
    await pool.end();
    process.exit(1);
});

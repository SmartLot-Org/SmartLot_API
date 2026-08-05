import pool from '../database/db.js';

export default class TratoEmpresaGarageRepository {
    getAllAsync = async () => {
        const result = await pool.query('SELECT * FROM trato_empresa_garage ORDER BY id');
        return result.rows;
    };

    getByIdAsync = async (id) => {
        const result = await pool.query('SELECT * FROM trato_empresa_garage WHERE id = $1', [id]);
        return result.rows[0] ?? null;
    };

    getByEmpresaAsync = async (id_empresa) => {
        const result = await pool.query(
            'SELECT * FROM trato_empresa_garage WHERE id_empresa = $1 ORDER BY id',
            [id_empresa]
        );
        return result.rows;
    };

    getByGarageAsync = async (id_garage) => {
        const result = await pool.query(
            'SELECT * FROM trato_empresa_garage WHERE id_garage = $1 ORDER BY id',
            [id_garage]
        );
        return result.rows;
    };

    getByEmpresaGarageAsync = async (id_empresa, id_garage, excludeId = null) => {
        const result = await pool.query(
            `SELECT * FROM trato_empresa_garage
             WHERE id_empresa = $1 AND id_garage = $2 AND ($3::int IS NULL OR id <> $3)
             LIMIT 1`,
            [id_empresa, id_garage, excludeId]
        );
        return result.rows[0] ?? null;
    };

    createAsync = async (entity) => {
        const result = await pool.query(
            `INSERT INTO trato_empresa_garage
                (id_empresa, id_garage, cantidad_cocheras, precio_pickup, precio_auto)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [entity.id_empresa, entity.id_garage, entity.cantidad_cocheras, entity.precio_pickup, entity.precio_auto]
        );
        return result.rows[0];
    };

    updateAsync = async (id, entity) => {
        const result = await pool.query(
            `UPDATE trato_empresa_garage
             SET id_empresa = $1, id_garage = $2, cantidad_cocheras = $3,
                 precio_pickup = $4, precio_auto = $5
             WHERE id = $6
             RETURNING *`,
            [entity.id_empresa, entity.id_garage, entity.cantidad_cocheras, entity.precio_pickup, entity.precio_auto, id]
        );
        return result.rows[0] ?? null;
    };

    deleteAsync = async (id) => {
        const result = await pool.query('DELETE FROM trato_empresa_garage WHERE id = $1 RETURNING id', [id]);
        return result.rowCount > 0;
    };
}

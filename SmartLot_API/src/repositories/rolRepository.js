// rolRepository.js
import pool from '../database/db.js';

export default class RolRepository {
    constructor() {
        console.log('Estoy en: RolRepository.constructor()');
    }

    getAllAsync = async () => {
        const result = await pool.query('SELECT * FROM roles WHERE COALESCE("Borrado", false) = false ORDER BY id');
        return result.rows;
    }

    getByIdAsync = async (id) => {
        const result = await pool.query('SELECT * FROM roles WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rows[0] ?? null;
    }

    createAsync = async (entity) => {
        const result = await pool.query(
            'INSERT INTO roles (tipo_rol) VALUES ($1) RETURNING *',
            [entity.tipo_rol]
        );
        return result.rows[0];
    }

    updateAsync = async (id, entity) => {
        const result = await pool.query(
            'UPDATE roles SET tipo_rol = $1 WHERE id = $2 AND COALESCE("Borrado", false) = false RETURNING *',
            [entity.tipo_rol, id]
        );
        return result.rows[0] ?? null;
    }

    deleteAsync = async (id) => {
        const result = await pool.query('UPDATE roles SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rowCount > 0;
    }
}

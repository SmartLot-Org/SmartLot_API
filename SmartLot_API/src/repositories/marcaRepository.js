// marcaRepository.js
import pool from '../database/db.js';

export default class MarcaRepository {
    constructor() {
        console.log('Estoy en: MarcaRepository.constructor()');
    }

    getAllAsync = async () => {
        const result = await pool.query('SELECT * FROM marcas WHERE COALESCE("Borrado", false) = false ORDER BY id');
        return result.rows;
    }

    getByIdAsync = async (id) => {
        const result = await pool.query('SELECT * FROM marcas WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rows[0] ?? null;
    }

    createAsync = async (entity) => {
        const result = await pool.query(
            'INSERT INTO marcas (nombre) VALUES ($1) RETURNING *',
            [entity.nombre]
        );
        return result.rows[0];
    }

    updateAsync = async (id, entity) => {
        const result = await pool.query(
            'UPDATE marcas SET nombre = $1 WHERE id = $2 AND COALESCE("Borrado", false) = false RETURNING *',
            [entity.nombre, id]
        );
        return result.rows[0] ?? null;
    }

    deleteAsync = async (id) => {
        const result = await pool.query('UPDATE marcas SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rowCount > 0;
    }
}

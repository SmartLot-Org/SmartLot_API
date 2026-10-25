// modeloRepository.js
import pool from '../database/db.js';

export default class ModeloRepository {
    constructor() {
        console.log('Estoy en: ModeloRepository.constructor()');
    }

    getAllAsync = async () => {
        const result = await pool.query('SELECT * FROM modelos WHERE COALESCE("Borrado", false) = false ORDER BY id');
        return result.rows;
    }

    getByIdAsync = async (id) => {
        const result = await pool.query('SELECT * FROM modelos WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rows[0] ?? null;
    }

    createAsync = async (entity) => {
        const result = await pool.query(
            'INSERT INTO modelos (id_marca, nombre) VALUES ($1, $2) RETURNING *',
            [entity.id_marca, entity.nombre]
        );
        return result.rows[0];
    }

    updateAsync = async (id, entity) => {
        const result = await pool.query(
            'UPDATE modelos SET id_marca = $1, nombre = $2 WHERE id = $3 AND COALESCE("Borrado", false) = false RETURNING *',
            [entity.id_marca, entity.nombre, id]
        );
        return result.rows[0] ?? null;
    }

    deleteAsync = async (id) => {
        const result = await pool.query('UPDATE modelos SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rowCount > 0;
    }
}

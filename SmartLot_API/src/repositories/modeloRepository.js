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
            'INSERT INTO modelos (id_marca, nombre, tipo_vehiculo) VALUES ($1, $2, $3) RETURNING *',
            [entity.id_marca, entity.nombre, entity.tipo_vehiculo]
        );
        return result.rows[0];
    }

    updateAsync = async (id, entity) => {
        const result = await pool.query(
            'UPDATE modelos SET id_marca = $1, nombre = $2, tipo_vehiculo = $3 WHERE id = $4 AND COALESCE("Borrado", false) = false RETURNING *',
            [entity.id_marca, entity.nombre, entity.tipo_vehiculo, id]
        );
        return result.rows[0] ?? null;
    }

    deleteAsync = async (id) => {
        const result = await pool.query('UPDATE modelos SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rowCount > 0;
    }
}

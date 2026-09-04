// vehiculoRepository.js
import pool from '../database/db.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';

export default class VehiculoRepository {
    constructor() {
        console.log('Estoy en: VehiculoRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 1, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
            const result = await pool.query(
                `SELECT v.* FROM vehiculos v
                 INNER JOIN usuarios u ON u.id = v.id_usuario
                 WHERE COALESCE(v."Borrado", false) = false ${tenant.sql}
                 ORDER BY v.id`,
                [...tenant.params]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getByIdAsync = async (id, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
            const result = await pool.query(
                `SELECT v.* FROM vehiculos v
                 INNER JOIN usuarios u ON u.id = v.id_usuario
                 WHERE v.id = $1 AND COALESCE(v."Borrado", false) = false ${tenant.sql}`,
                [id, ...tenant.params]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    getByPatenteAsync = async (patente) => {
        try {
            const result = await pool.query('SELECT * FROM vehiculos WHERE patente = $1 AND COALESCE("Borrado", false) = false', [patente]);
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    getByPatenteIncludingDeletedAsync = async (patente) => {
        try {
            const result = await pool.query('SELECT * FROM vehiculos WHERE patente = $1', [patente]);
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    createAsync = async (entity) => {
        try {
            const result = await pool.query(
                'INSERT INTO vehiculos (id_usuario, id_modelo, patente, tipo_vehiculo) VALUES ($1, $2, $3, $4) RETURNING *',
                [entity.id_usuario, entity.id_modelo, entity.patente, entity.tipo_vehiculo]
            );
            return result.rows[0];
        } catch (error) { console.error(error); return null; }
    }

    updateAsync = async (id, entity) => {
        try {
            const updates = [];
            const values = [];
            for (const column of ['id_usuario', 'id_modelo', 'patente', 'tipo_vehiculo']) {
                if (entity[column] !== undefined) {
                    values.push(entity[column]);
                    updates.push(`${column} = $${values.length}`);
                }
            }
            if (updates.length === 0) return await this.getByIdAsync(id);
            const result = await pool.query(
                `UPDATE vehiculos SET ${updates.join(', ')} WHERE id = $${values.length + 1} AND COALESCE("Borrado", false) = false RETURNING *`,
                [...values, id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    reactivateAsync = async (id, entity) => {
        try {
            const result = await pool.query(
                'UPDATE vehiculos SET id_usuario = $1, id_modelo = $2, patente = $3, tipo_vehiculo = $4, "Borrado" = false WHERE id = $5 RETURNING *',
                [entity.id_usuario, entity.id_modelo, entity.patente, entity.tipo_vehiculo, id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    deleteAsync = async (id) => {
        try {
            const result = await pool.query('UPDATE vehiculos SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
            return result.rowCount > 0;
        } catch (error) { console.error(error); return false; }
    }
}

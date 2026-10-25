// vehiculoRepository.js
import pool from '../database/db.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';

export default class VehiculoRepository {
    constructor() {
        console.log('Estoy en: VehiculoRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        const tenant = getTenantCondition(requestingUser, 1, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
        const result = await pool.query(
            `SELECT v.* FROM vehiculos v
             INNER JOIN usuarios u ON u.id = v.id_usuario
             WHERE COALESCE(v."Borrado", false) = false ${tenant.sql}
             ORDER BY v.id`,
            [...tenant.params]
        );
        return result.rows;
    }

    getByIdAsync = async (id, requestingUser = null) => {
        const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
        const result = await pool.query(
            `SELECT v.* FROM vehiculos v
             INNER JOIN usuarios u ON u.id = v.id_usuario
             WHERE v.id = $1 AND COALESCE(v."Borrado", false) = false ${tenant.sql}`,
            [id, ...tenant.params]
        );
        return result.rows[0] ?? null;
    }

    getByPatenteAsync = async (patente) => {
        const result = await pool.query('SELECT * FROM vehiculos WHERE patente = $1 AND COALESCE("Borrado", false) = false', [patente]);
        return result.rows[0] ?? null;
    }

    getByPatenteIncludingDeletedAsync = async (patente) => {
        const result = await pool.query('SELECT * FROM vehiculos WHERE patente = $1', [patente]);
        return result.rows[0] ?? null;
    }

    createAsync = async (entity) => {
        const result = await pool.query(
            'INSERT INTO vehiculos (id_usuario, id_modelo, patente, tipo_vehiculo) VALUES ($1, $2, $3, $4) RETURNING *',
            [entity.id_usuario, entity.id_modelo, entity.patente, entity.tipo_vehiculo]
        );
        return result.rows[0];
    }

    updateAsync = async (id, entity) => {
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
    }

    reactivateAsync = async (id, entity) => {
        const result = await pool.query(
            'UPDATE vehiculos SET id_usuario = $1, id_modelo = $2, patente = $3, tipo_vehiculo = $4, "Borrado" = false WHERE id = $5 RETURNING *',
            [entity.id_usuario, entity.id_modelo, entity.patente, entity.tipo_vehiculo, id]
        );
        return result.rows[0] ?? null;
    }

    deleteAsync = async (id) => {
        const result = await pool.query('UPDATE vehiculos SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rowCount > 0;
    }
}

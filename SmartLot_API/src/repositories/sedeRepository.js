// sedeRepository.js
import pool from '../database/db.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';

export default class SedeRepository {
    constructor() {
        console.log('Estoy en: SedeRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 1, { sedeColumn: 'sedes.id', empresaColumn: 'sedes.id_empresa' });
            const result = await pool.query(
                `SELECT * FROM sedes WHERE COALESCE("Borrado", false) = false ${tenant.sql} ORDER BY id`,
                [...tenant.params]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getByIdAsync = async (id, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 'sedes.id', empresaColumn: 'sedes.id_empresa' });
            const result = await pool.query(
                `SELECT * FROM sedes WHERE id = $1 AND COALESCE("Borrado", false) = false ${tenant.sql}`,
                [id, ...tenant.params]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    createAsync = async (entity) => {
        try {
            const result = await pool.query(
                'INSERT INTO sedes (id_empresa, nombre, descripcion, ubicacion, latitud, longitud) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [entity.id_empresa, entity.nombre, entity.descripcion, entity.ubicacion, entity.latitud ?? null, entity.longitud ?? null]
            );
            return result.rows[0];
        } catch (error) { console.error(error); return null; }
    }

    updateAsync = async (id, entity) => {
        try {
            const result = await pool.query(
                'UPDATE sedes SET id_empresa = $1, nombre = $2, descripcion = $3, ubicacion = $4, latitud = $5, longitud = $6 WHERE id = $7 AND COALESCE("Borrado", false) = false RETURNING *',
                [entity.id_empresa, entity.nombre, entity.descripcion, entity.ubicacion, entity.latitud ?? null, entity.longitud ?? null, id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    deleteAsync = async (id) => {
        try {
            const result = await pool.query('UPDATE sedes SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
            return result.rowCount > 0;
        } catch (error) { console.error(error); return false; }
    }
}

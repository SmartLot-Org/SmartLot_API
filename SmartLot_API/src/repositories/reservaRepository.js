// reservaRepository.js
import pool from '../database/db.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';

export default class ReservaRepository {
    constructor() {
        console.log('Estoy en: ReservaRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 1, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
            const result = await pool.query(
                `SELECT r.* FROM reservas r
                 INNER JOIN usuarios u ON u.id = r.id_usuario
                 WHERE COALESCE(r."Borrado", false) = false ${tenant.sql}
                 ORDER BY r.id`,
                [...tenant.params]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getControlAccesoAsync = async (id_garage, fecha, requestingUser) => {
        try {
            const tenant = getTenantCondition(requestingUser, 3, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
            const result = await pool.query(
                `SELECT r.*,
                        CONCAT_WS(' ', u.nombre, u.apellido) AS conductor,
                        v.patente,
                        mo.nombre AS modelo_nombre,
                        ma.nombre AS marca_nombre
                   FROM reservas r
                   INNER JOIN usuarios u ON u.id = r.id_usuario
                   INNER JOIN vehiculos v ON v.id = r.id_vehiculo
                   LEFT JOIN modelos mo ON mo.id = v.id_modelo
                   LEFT JOIN marcas ma ON ma.id = mo.id_marca
                  WHERE r.id_garage = $1
                    AND COALESCE(r."Borrado", false) = false
                    AND (r.fecha_entrada::date = $2::date
                         OR (COALESCE(r.entro, false) = true AND COALESCE(r.salio, false) = false))
                    ${tenant.sql}
                  ORDER BY r.fecha_entrada`,
                [id_garage, fecha, ...tenant.params]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getByIdAsync = async (id, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
            const result = await pool.query(
                `SELECT r.* FROM reservas r
                 INNER JOIN usuarios u ON u.id = r.id_usuario
                 WHERE r.id = $1 AND COALESCE(r."Borrado", false) = false ${tenant.sql}`,
                [id, ...tenant.params]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    getByIdForUpdateWithClientAsync = async (id, client) => {
        const result = await client.query(
            `SELECT r.*, v.patente
               FROM reservas r
               INNER JOIN vehiculos v ON v.id = r.id_vehiculo
              WHERE r.id = $1 AND COALESCE(r."Borrado", false) = false
              FOR UPDATE OF r`,
            [id]
        );
        return result.rows[0] ?? null;
    }

    getByUsuarioAsync = async (id_usuario, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
            const result = await pool.query(
                `SELECT r.* FROM reservas r
                 INNER JOIN usuarios u ON u.id = r.id_usuario
                 WHERE r.id_usuario = $1
                   AND COALESCE(r."Borrado", false) = false ${tenant.sql}
                 ORDER BY r.fecha_entrada`,
                [id_usuario, ...tenant.params]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getByUsuarioWithDetailsAsync = async (id_usuario, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
            const result = await pool.query(
                `SELECT
                    r.id,
                    r.id_usuario,
                    r.id_garage,
                    r.id_vehiculo,
                    r.fecha_entrada,
                    r.fecha_salida,
                    r.entro,
                    r.salio,
                    r.dia,
                    r."Borrado",
                    g.nombre AS garage_nombre,
                    g.piso AS garage_piso,
                    g.ubicacion AS garage_ubicacion,
                    v.patente,
                    mo.nombre AS modelo_nombre,
                    ma.nombre AS marca_nombre
                  FROM reservas r
                  INNER JOIN usuarios u ON u.id = r.id_usuario
                  LEFT JOIN garages g ON r.id_garage = g.id
                  LEFT JOIN vehiculos v ON r.id_vehiculo = v.id
                  LEFT JOIN modelos mo ON v.id_modelo = mo.id
                  LEFT JOIN marcas ma ON mo.id_marca = ma.id
                   WHERE r.id_usuario = $1 ${tenant.sql}
                   ORDER BY r.fecha_entrada DESC`,
                [id_usuario, ...tenant.params]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getActivasByUsuarioAsync = async (id_usuario) => {
        try {
            const result = await pool.query(
                `SELECT * FROM reservas
                 WHERE id_usuario = $1
                   AND COALESCE(salio, false) = false
                   AND COALESCE("Borrado", false) = false
                 ORDER BY fecha_entrada`,
                [id_usuario]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getActivasByGarageAsync = async (id_garage) => {
        try {
            const result = await pool.query(
                `SELECT * FROM reservas
                 WHERE id_garage = $1
                   AND COALESCE(salio, false) = false
                   AND COALESCE("Borrado", false) = false
                 ORDER BY fecha_entrada`,
                [id_garage]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getOverlapByVehiculoAsync = async (id_vehiculo, fecha_entrada, fecha_salida, excludeId = null) => {
        try {
            const result = await pool.query(
                `SELECT * FROM reservas
                  WHERE id_vehiculo = $1
                    AND fecha_entrada::date = $2::timestamp::date
                    AND (fecha_entrada < $3::timestamp AND fecha_salida > $2::timestamp)
                   AND COALESCE(salio, false) = false
                   AND COALESCE("Borrado", false) = false
                   AND ($4::integer IS NULL OR id != $4)`,
                [id_vehiculo, fecha_entrada, fecha_salida, excludeId]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getOverlapByUsuarioAsync = async (id_usuario, fecha_entrada, fecha_salida, excludeId = null) => {
        try {
            const result = await pool.query(
                `SELECT * FROM reservas
                  WHERE id_usuario = $1
                    AND fecha_entrada::date = $2::timestamp::date
                    AND (fecha_entrada < $3::timestamp AND fecha_salida > $2::timestamp)
                   AND COALESCE(salio, false) = false
                   AND COALESCE("Borrado", false) = false
                   AND ($4::integer IS NULL OR id != $4)`,
                [id_usuario, fecha_entrada, fecha_salida, excludeId]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getOverlapByGarageAsync = async (id_garage, fecha_entrada, fecha_salida, excludeId = null) => {
        try {
            const result = await pool.query(
                `SELECT * FROM reservas
                 WHERE id_garage = $1
                   AND fecha_entrada::date = $2::timestamp::date
                   AND (fecha_entrada < $3::timestamp AND fecha_salida > $2::timestamp)
                  AND COALESCE(salio, false) = false
                  AND COALESCE("Borrado", false) = false
                  AND ($4::integer IS NULL OR id != $4)`,
                [id_garage, fecha_entrada, fecha_salida, excludeId]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    createAsync = async (entity) => {
        try {
            const result = await pool.query(
                `INSERT INTO reservas (id_usuario, id_garage, id_vehiculo, fecha_entrada, fecha_salida, entro, salio, dia)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [entity.id_usuario, entity.id_garage, entity.id_vehiculo,
                 entity.fecha_entrada, entity.fecha_salida, entity.entro, entity.salio, entity.dia]
            );
            return result.rows[0];
        } catch (error) { console.error(error); return null; }
    }

    updateAsync = async (id, entity) => {
        try {
            const result = await pool.query(
                `UPDATE reservas SET id_usuario=$1, id_garage=$2, id_vehiculo=$3,
                 fecha_entrada=$4, fecha_salida=$5, entro=$6, salio=$7, dia=$8 WHERE id=$9 AND COALESCE("Borrado", false) = false RETURNING *`,
                [entity.id_usuario, entity.id_garage, entity.id_vehiculo,
                 entity.fecha_entrada, entity.fecha_salida, entity.entro, entity.salio, entity.dia, id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    createWithClientAsync = async (entity, client) => {
        const result = await client.query(
            `INSERT INTO reservas (id_usuario, id_garage, id_vehiculo, fecha_entrada, fecha_salida, entro, salio, dia)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [entity.id_usuario, entity.id_garage, entity.id_vehiculo,
             entity.fecha_entrada, entity.fecha_salida, entity.entro, entity.salio, entity.dia]
        );
        return result.rows[0];
    }

    cancelarWithClientAsync = async (id, client) => {
        const result = await client.query(
            'UPDATE reservas SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
            [id]
        );
        return result.rows[0] ?? null;
    }

    updateWithClientAsync = async (id, entity, client) => {
        const result = await client.query(
            `UPDATE reservas SET id_usuario=$1, id_garage=$2, id_vehiculo=$3,
             fecha_entrada=$4, fecha_salida=$5, entro=$6, salio=$7, dia=$8 WHERE id=$9 AND COALESCE("Borrado", false) = false RETURNING *`,
            [entity.id_usuario, entity.id_garage, entity.id_vehiculo,
             entity.fecha_entrada, entity.fecha_salida, entity.entro, entity.salio, entity.dia, id]
        );
        return result.rows[0] ?? null;
    }

    registrarIngresoWithClientAsync = async (id, client) => {
        const result = await client.query(
            'UPDATE reservas SET entro = true WHERE id = $1 AND COALESCE(entro, false) = false AND COALESCE(salio, false) = false AND COALESCE("Borrado", false) = false RETURNING *',
            [id]
        );
        return result.rows[0] ?? null;
    }

    getCountByUsuarioAndDateAsync = async (id_usuario, fecha, excludeId = null) => {
        try {
            const result = await pool.query(
                `SELECT COUNT(*) as count FROM reservas
                 WHERE id_usuario = $1
                   AND fecha_entrada::date = $2::date
                   AND COALESCE(salio, false) = false
                   AND COALESCE("Borrado", false) = false
                   AND ($3::integer IS NULL OR id != $3)`,
                [id_usuario, fecha, excludeId]
            );
            return parseInt(result.rows[0].count, 10);
        } catch (error) { console.error(error); return 0; }
    }

    registrarSalidaWithClientAsync = async (id, client) => {
        const result = await client.query(
            'UPDATE reservas SET salio = true WHERE id = $1 AND COALESCE(entro, false) = true AND COALESCE(salio, false) = false AND COALESCE("Borrado", false) = false RETURNING *',
            [id]
        );
        return result.rows[0] ?? null;
    }

    getOverlapByGarageAndDateAsync = async (id_garage, fecha) => {
        try {
            const result = await pool.query(
                `SELECT * FROM reservas
                 WHERE id_garage = $1
                   AND fecha_entrada::date = $2::date
                   AND COALESCE(salio, false) = false
                   AND COALESCE("Borrado", false) = false
                 ORDER BY fecha_entrada`,
                [id_garage, fecha]
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    deleteAsync = async (id) => {
        try {
            const result = await pool.query('UPDATE reservas SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
            return result.rowCount > 0;
        } catch (error) { console.error(error); return false; }
    }

    cancelarAsync = async (id) => await this.deleteAsync(id);
}

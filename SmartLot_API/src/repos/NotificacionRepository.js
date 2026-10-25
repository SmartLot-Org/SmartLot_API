// notificacionRepository.js
import pool from '../database/db.js';

export default class NotificacionRepository {
    constructor() {
        this.pool = pool;
    }

    listByUsuarioAsync = async (id_usuario, leida = null) => {
        let query;
        let params;

        if (leida === null) {
            query = `
                SELECT * FROM notificaciones
                WHERE id_usuario = $1
                ORDER BY created_at DESC
            `;
            params = [id_usuario];
        } else {
            query = `
                SELECT * FROM notificaciones
                WHERE id_usuario = $1 AND leida = $2
                ORDER BY created_at DESC
            `;
            params = [id_usuario, leida];
        }

        const result = await pool.query(query, params);
        return result.rows;
    }

    countNoLeidasByUsuarioAsync = async (id_usuario) => {
        const result = await pool.query(
            `SELECT COUNT(*) AS count FROM notificaciones WHERE id_usuario = $1 AND leida = false`, [id_usuario]
        );
        return result.rows[0].count;
    }

    marcarComoLeidaAsync = async (id, id_usuario) => {
        const result = await pool.query(
            `UPDATE notificaciones SET leida = true WHERE id = $1 AND id_usuario = $2 RETURNING *`,
            [id, id_usuario]
        );
        return result.rows[0] ?? null;
    }

    marcarTodasComoLeidasAsync = async (id_usuario) => {
        const result = await pool.query(
            `UPDATE notificaciones SET leida = true WHERE id_usuario = $1 AND leida = false`, [id_usuario]
        );
        return result.rowCount > 0;
    }

    esGaragistaAsync = async (id_usuario) => {
        const result = await pool.query(
            `SELECT 1 FROM usuarios u
             INNER JOIN roles r ON r.id = u.id_rol
             WHERE u.id = $1
               AND (u.id_rol = 3 OR lower(trim(r.tipo_rol)) = 'garagista')
             LIMIT 1`,
            [id_usuario]
        );
        return result.rowCount > 0;
    }

    insertarAsync = async (notificacion) => {
        const result = await pool.query(
            `INSERT INTO notificaciones (id_usuario, id_garage, tipo, mensaje, actor_nombre, id_relacion, leida, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
            [notificacion.id_usuario, notificacion.id_garage, notificacion.tipo, notificacion.mensaje, notificacion.actor_nombre, notificacion.id_relacion, notificacion.leida ?? false]
        );
        return result.rows[0];
    }

    eliminarAsync = async (id, id_usuario) => {
        const result = await pool.query(
            `DELETE FROM notificaciones WHERE id = $1 AND id_usuario = $2 RETURNING *`,
            [id, id_usuario]
        );
        return result.rowCount > 0;
    }
}
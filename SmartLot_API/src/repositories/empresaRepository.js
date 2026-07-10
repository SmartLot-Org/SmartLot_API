// empresaRepository.js
import pool from '../database/db.js';

export default class EmpresaRepository {
    constructor() {
        console.log('Estoy en: EmpresaRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        try {
            // Solo el superadmin (rol 4) puede listar todas las empresas.
            if (requestingUser && Number(requestingUser?.id_rol) !== 4) {
                return [];
            }
            const result = await pool.query('SELECT * FROM empresas WHERE COALESCE("Borrado", false) = false ORDER BY id');
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getByIdAsync = async (id, requestingUser = null) => {
        try {
            // Superadmin ve cualquier empresa. El resto solo la propia.
            if (requestingUser && Number(requestingUser?.id_rol) !== 4 && Number(requestingUser?.id_empresa) !== Number(id)) {
                return null;
            }
            const result = await pool.query('SELECT * FROM empresas WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    getAuditAsync = async () => {
        try {
            const result = await pool.query(
                `SELECT
                    e.*,
                    CONCAT_WS(' ', update_user.nombre, update_user.apellido) AS "UpdateByNombre",
                    update_user.email AS "UpdateByEmail",
                    CONCAT_WS(' ', delete_user.nombre, delete_user.apellido) AS "DeleteByNombre",
                    delete_user.email AS "DeleteByEmail"
                 FROM empresas e
                 LEFT JOIN usuarios update_user ON update_user.id = e."UpdateBy"
                 LEFT JOIN usuarios delete_user ON delete_user.id = e."DeleteBy"
                 WHERE e."UpdateAt" IS NOT NULL
                    OR e."DeleteAt" IS NOT NULL
                    OR COALESCE(e."Borrado", false) = true
                 ORDER BY COALESCE(e."DeleteAt", e."UpdateAt") DESC NULLS LAST, e.id DESC`
            );
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    createAsync = async (entity) => {
        try {
            const result = await pool.query(
                'INSERT INTO empresas (nombre, descripcion) VALUES ($1, $2) RETURNING *',
                [entity.nombre, entity.descripcion]
            );
            return result.rows[0];
        } catch (error) { console.error(error); return null; }
    }

    updateAsync = async (id, entity, updatedBy = null) => {
        try {
            const result = await pool.query(
                `UPDATE empresas
                 SET nombre = $1,
                     descripcion = $2,
                     "UpdateBy" = $3,
                     "UpdateAt" = NOW()
                 WHERE id = $4
                   AND COALESCE("Borrado", false) = false
                 RETURNING *`,
                [entity.nombre, entity.descripcion, updatedBy, id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    deleteAsync = async (id, deletedBy = null) => {
        try {
            const result = await pool.query(
                `UPDATE empresas
                 SET "Borrado" = true,
                     "DeleteBy" = $1,
                     "DeleteAt" = NOW()
                 WHERE id = $2
                   AND COALESCE("Borrado", false) = false`,
                [deletedBy, id]
            );
            return result.rowCount > 0;
        } catch (error) { console.error(error); return false; }
    }
}

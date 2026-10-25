// conflictoRepository.js
import pool from '../database/db.js';

let superAdminColumnCache;

const quoteIdentifier = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

const getSuperAdminColumnAsync = async () => {
    if (superAdminColumnCache !== undefined) return superAdminColumnCache;

    const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'conflictos'
           AND lower(column_name) = 'superadmin'
         LIMIT 1`
    );

    superAdminColumnCache = result.rows[0]?.column_name ?? null;
    return superAdminColumnCache;
};

const isPositiveNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
};

const getTenantCondition = (requestingUser, firstParamIndex = 2, userAlias = 'u') => {
    if (Number(requestingUser?.id_rol) === 4) {
        return { sql: '', params: [] };
    }

    const idSede = requestingUser?.id_sede ?? requestingUser?.idSede;
    if (isPositiveNumber(idSede)) {
        return {
            sql: ` AND ${userAlias}.id_sede = $${firstParamIndex}`,
            params: [Number(idSede)],
        };
    }

    const idEmpresa = requestingUser?.id_empresa ?? requestingUser?.idEmpresa;
    if (isPositiveNumber(idEmpresa)) {
        return {
            sql: ` AND ${userAlias}.id_empresa = $${firstParamIndex}`,
            params: [Number(idEmpresa)],
        };
    }

    return { sql: ' AND false', params: [] };
};

export default class ConflictoRepository {
    constructor() {
        console.log('Estoy en: ConflictoRepository.constructor()');
    }

    getAllAsync = async (superAdmin = false, requestingUser = null) => {
        const superAdminColumn = await getSuperAdminColumnAsync();
        const superAdminExpression = superAdminColumn ? `COALESCE(c.${quoteIdentifier(superAdminColumn)}, false)` : 'false';
        const tenant = getTenantCondition(requestingUser, 2, 'u');
        const result = await pool.query(
            `SELECT c.*
             FROM conflictos c
             INNER JOIN usuarios u ON u.id = c.id_usuario
             WHERE COALESCE(c."Borrado", false) = false
               AND ${superAdminExpression} = $1
               ${tenant.sql}
             ORDER BY c.id`,
            [superAdmin, ...tenant.params]
        );
        return result.rows;
    }

    getDeletedByUserAsync = async (deletedBy, superAdmin = false, requestingUser = null) => {
        try {
            const superAdminColumn = await getSuperAdminColumnAsync();
            const superAdminExpression = superAdminColumn ? `COALESCE(c.${quoteIdentifier(superAdminColumn)}, false)` : 'false';
            const tenant = getTenantCondition(requestingUser, 3, 'u');
            const result = await pool.query(
                `SELECT c.*
                 FROM conflictos c
                 INNER JOIN usuarios u ON u.id = c.id_usuario
                 WHERE COALESCE(c."Borrado", false) = true
                   AND ${superAdminExpression} = $1
                   AND c."DeleteBy" = $2
                   ${tenant.sql}
                 ORDER BY c."DeleteAt" DESC NULLS LAST, c.id DESC`,
                [superAdmin, deletedBy, ...tenant.params]
            );
            return result.rows;
        } catch (error) {
            // Compatibilidad con bases sin las columnas DeleteBy/DeleteAt (42703): se reintenta sin ellas.
            if (error.code === '42703') {
                const superAdminColumn = await getSuperAdminColumnAsync();
                const superAdminExpression = superAdminColumn ? `COALESCE(c.${quoteIdentifier(superAdminColumn)}, false)` : 'false';
                const tenant = getTenantCondition(requestingUser, 2, 'u');
                const result = await pool.query(
                    `SELECT c.*
                     FROM conflictos c
                     INNER JOIN usuarios u ON u.id = c.id_usuario
                     WHERE COALESCE(c."Borrado", false) = true
                       AND ${superAdminExpression} = $1
                       ${tenant.sql}
                     ORDER BY c.id DESC`,
                    [superAdmin, ...tenant.params]
                );
                return result.rows;
            }

            throw error;
        }
    }

    getByIdAsync = async (id, requestingUser = null) => {
        const tenant = getTenantCondition(requestingUser, 2, 'u');
        const result = await pool.query(
            `SELECT c.*
             FROM conflictos c
             INNER JOIN usuarios u ON u.id = c.id_usuario
             WHERE c.id = $1
               AND COALESCE(c."Borrado", false) = false
               ${tenant.sql}`,
            [id, ...tenant.params]
        );
        return result.rows[0] ?? null;
    }

    countActiveByUserAsync = async (userId) => {
        const result = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM conflictos
             WHERE id_usuario = $1
               AND COALESCE("Borrado", false) = false
               AND estado != 'Resuelto'`,
            [userId]
        );
        return result.rows[0]?.count ?? 0;
    }

    createAsync = async (entity) => {
        const superAdminColumn = await getSuperAdminColumnAsync();
        if (!superAdminColumn) {
            const result = await pool.query(
                `INSERT INTO conflictos (id_usuario, descripcion, prioridad, estado)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [entity.id_usuario, entity.descripcion, entity.prioridad, entity.estado || 'Pendiente']
            );
            return result.rows[0];
        }

        const result = await pool.query(
            `INSERT INTO conflictos (id_usuario, descripcion, prioridad, estado, ${quoteIdentifier(superAdminColumn)})
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [
                entity.id_usuario,
                entity.descripcion,
                entity.prioridad,
                entity.estado || 'Pendiente',
                entity.SuperAdmin === true
            ]
        );
        return result.rows[0];
    }

    updateAsync = async (id, entity, requestingUser = null) => {
        const tenant = getTenantCondition(requestingUser, 6, 'u');
        const superAdminColumn = await getSuperAdminColumnAsync();
        if (!superAdminColumn) {
            const result = await pool.query(
                `UPDATE conflictos c
                 SET id_usuario = $1,
                     descripcion = $2,
                     prioridad = $3,
                     estado = $4
                 FROM usuarios u
                 WHERE c.id = $5
                   AND u.id = c.id_usuario
                   AND COALESCE(c."Borrado", false) = false
                   ${tenant.sql}
                 RETURNING c.*`,
                [entity.id_usuario, entity.descripcion, entity.prioridad, entity.estado, id, ...tenant.params]
            );
            return result.rows[0] ?? null;
        }

        const result = await pool.query(
            `UPDATE conflictos c
             SET id_usuario = $1,
                 descripcion = $2,
                 prioridad = $3,
                 estado = $4,
                 ${quoteIdentifier(superAdminColumn)} = $5
             FROM usuarios u
             WHERE c.id = $6
               AND u.id = c.id_usuario
               AND COALESCE(c."Borrado", false) = false
               ${tenant.sql}
             RETURNING c.*`,
            [
                entity.id_usuario,
                entity.descripcion,
                entity.prioridad,
                entity.estado,
                entity.SuperAdmin === true,
                id,
                ...tenant.params
            ]
        );
        return result.rows[0] ?? null;
    }

    deleteAsync = async (id, deletedBy = null, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 3, 'u');
            const result = await pool.query(
                `UPDATE conflictos c
                 SET "Borrado" = true,
                     "DeleteBy" = $2,
                     "DeleteAt" = NOW()
                 FROM usuarios u
                 WHERE c.id = $1
                   AND u.id = c.id_usuario
                   AND COALESCE(c."Borrado", false) = false
                   ${tenant.sql}`,
                [id, deletedBy, ...tenant.params]
            );
            return result.rowCount > 0;
        } catch (error) {
            // Compatibilidad con bases sin las columnas DeleteBy/DeleteAt (42703): se reintenta sin ellas.
            if (error.code === '42703') {
                const tenant = getTenantCondition(requestingUser, 2, 'u');
                const result = await pool.query(
                    `UPDATE conflictos c
                     SET "Borrado" = true
                     FROM usuarios u
                     WHERE c.id = $1
                       AND u.id = c.id_usuario
                       AND COALESCE(c."Borrado", false) = false
                       ${tenant.sql}`,
                    [id, ...tenant.params]
                );
                return result.rowCount > 0;
            }

            throw error;
        }
    }

    restoreAsync = async (id, deletedBy = null, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 3, 'u');
            const result = await pool.query(
                `UPDATE conflictos c
                 SET "Borrado" = false,
                     "DeleteBy" = NULL,
                     "DeleteAt" = NULL
                 FROM usuarios u
                 WHERE c.id = $1
                   AND u.id = c.id_usuario
                   AND COALESCE(c."Borrado", false) = true
                   AND ($2::int IS NULL OR c."DeleteBy" = $2)
                   ${tenant.sql}
                 RETURNING c.*`,
                [id, deletedBy, ...tenant.params]
            );
            return result.rows[0] ?? null;
        } catch (error) {
            // Compatibilidad con bases sin las columnas DeleteBy/DeleteAt (42703): se reintenta sin ellas.
            if (error.code === '42703') {
                const tenant = getTenantCondition(requestingUser, 2, 'u');
                const result = await pool.query(
                    `UPDATE conflictos c
                     SET "Borrado" = false
                     FROM usuarios u
                     WHERE c.id = $1
                       AND u.id = c.id_usuario
                       AND COALESCE(c."Borrado", false) = true
                       ${tenant.sql}
                     RETURNING c.*`,
                    [id, ...tenant.params]
                );
                return result.rows[0] ?? null;
            }

            throw error;
        }
    }
}

// usuarioRepository.js
import pool from '../database/db.js';
import { writeTenantFilter } from '../helpers/writeTenantFilter.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';
import { httpError } from '../helpers/httpError.js';

export default class UsuarioRepository {
    constructor() {
        console.log('Estoy en: UsuarioRepository.constructor()');
    }

    createSessionAsync = async (usuario_id, token_version, refresh_token, expires_at) => {
        const result = await pool.query(
            `INSERT INTO refresh_sessions (usuario_id, token_version, refresh_token, expires_at)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [usuario_id, token_version, refresh_token, expires_at]
        );
        return result.rows[0].id;
    }

    getSessionAsync = async (session_id) => {
        const result = await pool.query(
            'SELECT * FROM refresh_sessions WHERE id = $1 AND expires_at > NOW()',
            [session_id]
        );
        return result.rows[0] ?? null;
    }

    deleteSessionAsync = async (session_id) => {
        await pool.query('DELETE FROM refresh_sessions WHERE id = $1', [session_id]);
    }

    deleteUserSessionsAsync = async (usuario_id) => {
        await pool.query('DELETE FROM refresh_sessions WHERE usuario_id = $1', [usuario_id]);
    }

    revokeLogoutSessionsAsync = async (id, version, client) => {
        // El UPDATE comprueba la version persistida y bloquea la fila en la misma
        // operacion. Un segundo logout con esa version no puede volver a revocar.
        const updated = await client.query(`UPDATE usuarios SET token_version=token_version+1
            WHERE id=$1 AND token_version=$2 AND COALESCE(activo,true)=true
              AND COALESCE("Borrado",false)=false RETURNING id`, [id, version]);
        if (!updated.rows.length) return false;
        await client.query('DELETE FROM refresh_sessions WHERE usuario_id=$1', [id]);
        return true;
    }

    updateReservationLimitAsync = async (id, limit, actor) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const target = (await client.query(
                `SELECT u.id,u.id_rol,u.activo,u.id_sede,
                        COALESCE(u.id_empresa,s.id_empresa) AS id_empresa
                   FROM usuarios u LEFT JOIN sedes s ON s.id=u.id_sede
                  WHERE u.id=$1 AND u."Borrado"=false FOR UPDATE OF u`, [id]
            )).rows[0];
            if (!target || target.activo === false || Number(target.id_rol) !== 2) {
                throw Object.assign(new Error('Empleado activo inexistente.'), { statusCode: 404 });
            }
            if (!hasRole(actor, 4, ROLE_NAMES.SUPERADMIN) && (
                !hasRole(actor, 1, ROLE_NAMES.ADMIN) || !actor.id_empresa ||
                Number(actor.id_empresa) !== Number(target.id_empresa) ||
                (actor.id_sede != null && Number(actor.id_sede) !== Number(target.id_sede))
            )) throw Object.assign(new Error('No tiene permisos para modificar este empleado.'), { statusCode: 403 });
            const result = await client.query(
                `UPDATE usuarios SET limite_reservas_activas=$1, "UpdateBy"=$2, "UpdateAt"=NOW()
                  WHERE id=$3 RETURNING id AS "idUsuario", limite_reservas_activas AS "limiteReservasActivas"`,
                [limit, actor.id, id]
            );
            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    };

    getAllAsync = async (requestingUser = null) => {
        const tenant = getTenantCondition(requestingUser, 1, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
        const result = await pool.query(
            `SELECT u.*, r.tipo_rol,
                CASE WHEN lower(r.tipo_rol) IN ('garagista', 'dueño_garage') THEN garages.id_garage ELSE NULL END AS id_garage,
                CASE WHEN lower(r.tipo_rol) IN ('garagista', 'dueño_garage') THEN COALESCE(garages.id_garages, '{}'::int[]) ELSE '{}'::int[] END AS id_garages
             FROM usuarios u
             LEFT JOIN roles r ON r.id = u.id_rol
             LEFT JOIN LATERAL (
                SELECT MIN(ug.id_garage) AS id_garage,
                       ARRAY_AGG(DISTINCT ug.id_garage ORDER BY ug.id_garage) AS id_garages
                FROM usuario_garage ug
                WHERE ug.id_usuario = u.id
             ) garages ON true
             WHERE COALESCE(u."Borrado", false) = false ${tenant.sql}
             ORDER BY u.id`,
            [...tenant.params]
        );
        return result.rows;
    }

    getByIdAsync = async (id, requestingUser = null) => {
        // Cada usuario siempre puede leer su propio registro (la ruta valida
        // que sea admin, superadmin o el propio usuario). Los garagistas y
        // dueños no tienen id_sede/id_empresa y no deben quedar bloqueados.
        const tenant = requestingUser && Number(requestingUser.id) === Number(id)
            ? { sql: '', params: [] }
            : getTenantCondition(requestingUser, 2, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
        const result = await pool.query(
            `SELECT u.*, r.tipo_rol,
                CASE WHEN lower(r.tipo_rol) IN ('garagista', 'dueño_garage') THEN garages.id_garage ELSE NULL END AS id_garage,
                CASE WHEN lower(r.tipo_rol) IN ('garagista', 'dueño_garage') THEN COALESCE(garages.id_garages, '{}'::int[]) ELSE '{}'::int[] END AS id_garages
             FROM usuarios u
             LEFT JOIN roles r ON r.id = u.id_rol
             LEFT JOIN LATERAL (
                SELECT MIN(ug.id_garage) AS id_garage,
                       ARRAY_AGG(DISTINCT ug.id_garage ORDER BY ug.id_garage) AS id_garages
                FROM usuario_garage ug
                WHERE ug.id_usuario = u.id
             ) garages ON true
             WHERE u.id = $1 AND COALESCE(u."Borrado", false) = false ${tenant.sql}`,
            [id, ...tenant.params]
        );
        return result.rows[0] ?? null;
    }

    getByEmailAsync = async (email) => {
        const result = await pool.query(
            `SELECT u.*, r.tipo_rol,
                CASE WHEN lower(r.tipo_rol) IN ('garagista', 'dueño_garage') THEN garages.id_garage ELSE NULL END AS id_garage,
                CASE WHEN lower(r.tipo_rol) IN ('garagista', 'dueño_garage') THEN COALESCE(garages.id_garages, '{}'::int[]) ELSE '{}'::int[] END AS id_garages
             FROM usuarios u
             LEFT JOIN roles r ON r.id = u.id_rol
             LEFT JOIN LATERAL (
                SELECT MIN(ug.id_garage) AS id_garage,
                       ARRAY_AGG(DISTINCT ug.id_garage ORDER BY ug.id_garage) AS id_garages
                FROM usuario_garage ug
                WHERE ug.id_usuario = u.id
             ) garages ON true
             WHERE u.email = $1 AND COALESCE(u."Borrado", false) = false`,
            [email]
        );
        return result.rows[0] ?? null;
    }

    getAuditAsync = async () => {
        const result = await pool.query(
            `SELECT
                u.id,
                u.id_rol,
                u.nombre,
                u.apellido,
                u.email,
                u.activo,
                u."Borrado",
                u."UpdateBy",
                u."UpdateAt",
                u."DeleteBy",
                u."DeleteAt",
                CONCAT_WS(' ', update_user.nombre, update_user.apellido) AS "UpdateByNombre",
                update_user.email AS "UpdateByEmail",
                CONCAT_WS(' ', delete_user.nombre, delete_user.apellido) AS "DeleteByNombre",
                delete_user.email AS "DeleteByEmail"
             FROM usuarios u
             LEFT JOIN usuarios update_user ON update_user.id = u."UpdateBy"
             LEFT JOIN usuarios delete_user ON delete_user.id = u."DeleteBy"
             WHERE u."UpdateAt" IS NOT NULL
                OR u."DeleteAt" IS NOT NULL
                OR COALESCE(u."Borrado", false) = true
             ORDER BY COALESCE(u."DeleteAt", u."UpdateAt") DESC NULLS LAST, u.id DESC`
        );
        return result.rows;
    }

    createAsync = async (entity) => {
        try {
            const result = await pool.query(
                `INSERT INTO usuarios (id_rol, nombre, apellido, id_sede, email, telefono, contraseña, id_empresa, activo, token_version, limite_reservas_activas)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [entity.id_rol, entity.nombre, entity.apellido, entity.id_sede,
                entity.email, entity.telefono, entity.contraseña, entity.id_empresa, entity.activo, entity.token_version ?? 0, entity.limite_reservas_activas ?? null]
            );
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505') throw httpError('Ya existe un usuario con ese email.', 409);
            throw error;
        }
    }

    createWithClientAsync = async (entity, client) => {
        try {
            const result = await client.query(
                `INSERT INTO usuarios (id_rol, nombre, apellido, id_sede, email, telefono, contraseña, id_empresa, activo, token_version, limite_reservas_activas)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [entity.id_rol, entity.nombre, entity.apellido, entity.id_sede,
                entity.email, entity.telefono, entity.contraseña, entity.id_empresa, entity.activo, entity.token_version ?? 0, entity.limite_reservas_activas ?? null]
            );
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505') throw httpError('Ya existe un usuario con ese email.', 409);
            throw error;
        }
    }

    updateAsync = async (id, entity, scope, client = pool) => {
        // Una edicion de perfil nunca restaura un estado/token_version leido
        // antes de una desactivacion o revocacion concurrente.
        const filter = writeTenantFilter(scope, 11, { company: 'usuarios.id_empresa', site: 'usuarios.id_sede', owner: 'usuarios.id' });
        const result = await client.query(
            `UPDATE usuarios SET id_rol=$1, nombre=$2, apellido=$3, id_sede=$4,
             email=$5, telefono=$6, contraseña=$7, id_empresa=$8,
             "UpdateBy"=$9, "UpdateAt"=NOW()
             WHERE id=$10 AND COALESCE("Borrado", false) = false ${filter.sql} RETURNING *`,
            [entity.id_rol, entity.nombre, entity.apellido, entity.id_sede,
                entity.email, entity.telefono, entity.contraseña, entity.id_empresa, scope?.actorId, id, ...filter.params]
        );
        return result.rows[0] ?? null;
    }

    getForLifecycleAsync = async (id, scope, client) => {
        const filter = writeTenantFilter(scope, 2, { company: 'u.id_empresa', site: 'u.id_sede', owner: 'u.id' });
        return (await client.query(`SELECT u.*,r.tipo_rol FROM usuarios u
            JOIN roles r ON r.id=u.id_rol WHERE u.id=$1
            AND COALESCE(u."Borrado",false)=false ${filter.sql} FOR UPDATE OF u`,
        [id, ...filter.params])).rows[0] ?? null;
    }

    getForEditAsync = async (id, scope, client) => this.getForLifecycleAsync(id, scope, client);

    getEditRoleAsync = async (id, client) => (await client.query(`SELECT * FROM roles
        WHERE id=$1 AND COALESCE("Borrado",false)=false FOR SHARE`, [id])).rows[0] ?? null;

    getEditEmailAsync = async (email, client) => (await client.query(
        'SELECT id FROM usuarios WHERE email=$1 AND COALESCE("Borrado",false)=false', [email])).rows[0] ?? null;

    validateEditDestinationAsync = async (entity, client) => {
        if (!await this.getEditRoleAsync(entity.id_rol, client)) throw httpError('El rol indicado no existe.', 400);
        if (entity.id_empresa != null) {
            const company = (await client.query(`SELECT id FROM empresas WHERE id=$1
                AND COALESCE("Borrado",false)=false FOR SHARE`, [entity.id_empresa])).rows[0];
            if (!company) throw httpError('La empresa indicada no existe.', 400);
        }
        if (entity.id_sede != null) {
            const site = (await client.query(`SELECT id,id_empresa FROM sedes WHERE id=$1
                AND COALESCE("Borrado",false)=false FOR SHARE`, [entity.id_sede])).rows[0];
            if (!site) throw httpError('La sede indicada no existe.', 400);
            return site;
        }
        return null;
    }

    validateLifecycleReservationsAsync = async (id, deleting, client) => {
        const result = await client.query(`SELECT id FROM reservas WHERE id_usuario=$1
            AND COALESCE("Borrado",false)=false ${deleting ? '' : 'AND COALESCE(salio,false)=false'} LIMIT 1`, [id]);
        if (result.rows.length) throw httpError(deleting ?
            'No se puede eliminar el usuario porque tiene reservas asociadas.' :
            'No se puede desactivar el usuario porque tiene reservas activas.', 400);
    }

    revokeLifecycleSessionsAsync = async (id, client) => {
        await client.query('DELETE FROM refresh_sessions WHERE usuario_id=$1', [id]);
    }

    updateEstadoAsync = async (id, activo, scope, client = pool) => {
        const filter = writeTenantFilter(scope, 5, { company: 'usuarios.id_empresa', site: 'usuarios.id_sede' });
        const result = await client.query(
            `UPDATE usuarios
             SET activo = $1,
                 "UpdateBy" = $2,
                 "UpdateAt" = NOW(),
                 token_version = COALESCE(token_version,0) + 1
             WHERE id = $3
               AND COALESCE("Borrado", false) = false ${filter.sql}
               AND ($4::boolean OR id_rol<>4)
             RETURNING *`,
            [activo, scope?.actorId, id, scope?.kind === 'global', ...filter.params]
        );
        return result.rows[0] ?? null;
    }

    updateContraseñaAsync = async (id, contraseña, scope, client = pool) => {
        const filter = writeTenantFilter(scope, 4, { company: 'usuarios.id_empresa', site: 'usuarios.id_sede', owner: 'usuarios.id' });
        return (await client.query(`UPDATE usuarios SET contraseña=$1,
            token_version=COALESCE(token_version,0)+1,"UpdateBy"=$2,"UpdateAt"=NOW()
            WHERE id=$3 AND COALESCE("Borrado",false)=false ${filter.sql} RETURNING *`,
        [contraseña, scope?.actorId, id, ...filter.params])).rows[0] ?? null;
    }

    incrementTokenVersionAsync = async (id) => {
        const result = await pool.query(
            'UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING token_version',
            [id]
        );
        return result.rows[0]?.token_version ?? null;
    }

    deleteAsync = async (id, scope, client = pool) => {
        const filter = writeTenantFilter(scope, 4, { company: 'usuarios.id_empresa', site: 'usuarios.id_sede' });
        const result = await client.query(
            `UPDATE usuarios
             SET "Borrado" = true,
                 "DeleteBy" = $1,
                 "DeleteAt" = NOW(),
                 token_version = COALESCE(token_version,0) + 1
             WHERE id = $2
               AND COALESCE("Borrado", false) = false ${filter.sql}
               AND ($3::boolean OR id_rol<>4)`,
            [scope?.actorId, id, scope?.kind === 'global', ...filter.params]
        );
        return result.rowCount > 0;
    }

    getSuperadminsActivosAsync = async () => {
        const result = await pool.query(
            `SELECT u.id, u.email, u.nombre, u.apellido
              FROM usuarios u
              INNER JOIN roles r ON r.id = u.id_rol
              WHERE (u.id_rol = 4 OR lower(trim(r.tipo_rol)) = 'superadmin')
                AND COALESCE(u.activo, true) = true
                AND COALESCE(u."Borrado", false) = false
                AND COALESCE(r."Borrado", false) = false`
        );
        return result.rows;
    }

}

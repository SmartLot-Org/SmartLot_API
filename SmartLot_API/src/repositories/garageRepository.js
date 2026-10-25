// garageRepository.js
import pool from '../database/db.js';
import { getDiasSemana } from '../helpers/validatorHelper.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';
import { isGarageOccupancyScope } from '../helpers/garageOccupancyAuthorization.js';

// Solo para ocupacion sin reserva. No usa tratos ni los permisos de consulta.
// Se repite en cada UPDATE aunque el servicio ya haya bloqueado las relaciones.
function occupancyFilter(scope) {
    if (!isGarageOccupancyScope(scope)) return { sql: ' AND false', params: [] };
    let sql = ` AND EXISTS (SELECT 1 FROM usuarios u JOIN roles r ON r.id=u.id_rol
        WHERE u.id=$2 AND u.id_rol=$3 AND COALESCE(u.activo,true)=true
        AND COALESCE(u."Borrado",false)=false AND COALESCE(r."Borrado",false)=false
        AND ($3::integer<>1 OR (u.id_empresa=$4::integer AND u.id_sede IS NOT DISTINCT FROM $5::integer)))`;
    if (scope.kind === 'assigned') sql += ` AND EXISTS (SELECT 1 FROM usuario_garage ug
        WHERE ug.id_usuario=$2 AND ug.id_garage=g.id)`;
    if (scope.kind === 'owned') sql += ` AND EXISTS (SELECT 1 FROM sedes s
        WHERE s.id=g.id_sede_propia AND s.id_empresa=$4 AND COALESCE(s."Borrado",false)=false
        AND ($5::integer IS NULL OR s.id=$5))`;
    return { sql, params: [scope.actorId, scope.roleId, scope.companyId ?? null, scope.siteId ?? null] };
}

export default class GarageRepository {
    constructor() {
        console.log('Estoy en: GarageRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        let accessSql = '';
        const params = [];
        if (requestingUser && !hasRole(requestingUser, 4, ROLE_NAMES.SUPERADMIN)) {
            if (hasRole(requestingUser, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.GARAGISTA)) {
                params.push(requestingUser?.id);
                accessSql = ` AND EXISTS (SELECT 1 FROM usuario_garage ug WHERE ug.id_usuario = $${params.length} AND ug.id_garage = g.id)`;
            } else {
                params.push(requestingUser?.id_empresa);
                accessSql = ` AND EXISTS (SELECT 1 FROM trato_empresa_garage teg JOIN sedes ts ON ts.id=teg.id_sede WHERE ts.id_empresa = $${params.length} AND teg.id_garage = g.id`;
                if (requestingUser?.id_sede) {
                    params.push(requestingUser.id_sede);
                    accessSql += ` AND teg.id_sede = $${params.length}`;
                }
                accessSql += ' AND COALESCE(teg."Borrado", false) = false)';
            }
        }
        const result = await pool.query(`
            SELECT g.*, COALESCE(
                (SELECT array_agg(gd.dia::text ORDER BY gd.dia) FROM garage_dias gd WHERE gd.id_garage = g.id AND gd.activo = true),
                '{}'::text[]
            ) AS dias
            FROM garages g
            WHERE COALESCE(g."Borrado", false) = false ${accessSql}
            ORDER BY g.id
        `, params);
        return result.rows;
    }

    getPapeleraAsync = async (requestingUser = null) => {
        let accessSql = '';
        const params = [];
        if (requestingUser && !hasRole(requestingUser, 4, ROLE_NAMES.SUPERADMIN)) {
            if (hasRole(requestingUser, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.GARAGISTA)) {
                params.push(requestingUser?.id);
                accessSql = ` AND EXISTS (SELECT 1 FROM usuario_garage ug WHERE ug.id_usuario = $${params.length} AND ug.id_garage = g.id)`;
            } else {
                params.push(requestingUser?.id_empresa);
                accessSql = ` AND EXISTS (SELECT 1 FROM trato_empresa_garage teg JOIN sedes ts ON ts.id=teg.id_sede WHERE ts.id_empresa = $${params.length} AND teg.id_garage = g.id`;
                if (requestingUser?.id_sede) {
                    params.push(requestingUser.id_sede);
                    accessSql += ` AND teg.id_sede = $${params.length}`;
                }
                accessSql += ' AND COALESCE(teg."Borrado", false) = false)';
            }
        }
        const result = await pool.query(`
            SELECT g.*, COALESCE(
                (SELECT array_agg(gd.dia::text ORDER BY gd.dia) FROM garage_dias gd WHERE gd.id_garage = g.id AND gd.activo = true),
                '{}'::text[]
            ) AS dias
            FROM garages g
            WHERE COALESCE(g."Borrado", false) = true ${accessSql}
            ORDER BY g.id
        `, params);
        return result.rows;
    }

    getByIdAsync = async (id, requestingUser = null) => {
        let accessSql = '';
        const params = [id];
        if (requestingUser && !hasRole(requestingUser, 4, ROLE_NAMES.SUPERADMIN)) {
            if (hasRole(requestingUser, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.GARAGISTA)) {
                params.push(requestingUser?.id);
                accessSql = ` AND EXISTS (SELECT 1 FROM usuario_garage ug WHERE ug.id_usuario = $${params.length} AND ug.id_garage = g.id)`;
            } else {
                params.push(requestingUser?.id_empresa);
                accessSql = ` AND EXISTS (SELECT 1 FROM trato_empresa_garage teg JOIN sedes ts ON ts.id=teg.id_sede WHERE ts.id_empresa = $${params.length} AND teg.id_garage = g.id`;
                if (requestingUser?.id_sede) {
                    params.push(requestingUser.id_sede);
                    accessSql += ` AND teg.id_sede = $${params.length}`;
                }
                accessSql += ' AND COALESCE(teg."Borrado", false) = false)';
            }
        }
        const result = await pool.query(`
            SELECT g.*, COALESCE(
                (SELECT array_agg(gd.dia::text ORDER BY gd.dia) FROM garage_dias gd WHERE gd.id_garage = g.id AND gd.activo = true),
                '{}'::text[]
            ) AS dias
            FROM garages g
            WHERE g.id = $1 AND COALESCE(g."Borrado", false) = false ${accessSql}
        `, params);
        return result.rows[0] ?? null;
    }

    getByIdForUpdateWithClientAsync = async (id, client) => {
        const result = await client.query('SELECT * FROM garages WHERE id = $1 AND COALESCE("Borrado", false) = false FOR UPDATE', [id]);
        return result.rows[0] ?? null;
    }

    getOcupacionReservaAsync = async (id) => {
        const result = await pool.query('SELECT ocupacion_reservas FROM garages WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rows;
    }

    getOcupacionNoReservaAsync = async (id) => {
        const result = await pool.query('SELECT ocupacion_no_reservas FROM garages WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
        return result.rows;
    }

    getPropioBySedeAsync = async (idSede) => {
        const result = await pool.query(
            `SELECT * FROM garages
             WHERE id_sede_propia = $1 AND COALESCE("Borrado", false) = false
             LIMIT 1`,
            [idSede]
        );
        return result.rows[0] ?? null;
    }

    createAsync = async (entity) => {
        const result = await pool.query(
            `INSERT INTO garages (nombre, piso, ubicacion, latitud, longitud, estado, capacidad, capacidad_para_no_reservas, capacidad_reservas, ocupacion_reservas, ocupacion_no_reservas, hora_apertura, hora_cierre, precio_pickup, precio_auto, precio_moto)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
            [entity.nombre, entity.piso, entity.ubicacion, entity.latitud ?? null, entity.longitud ?? null, entity.estado,
            entity.capacidad, entity.capacidad_para_no_reservas, entity.capacidad_reservas, entity.ocupacion_reservas, entity.ocupacion_no_reservas,
            entity.hora_apertura, entity.hora_cierre, entity.precio_pickup ?? null, entity.precio_auto ?? null, entity.precio_moto ?? null]
        );
        const garage = result.rows[0];
        if (garage && entity.dias && entity.dias.length > 0) {
            const todosLosDias = getDiasSemana();
            for (const dia of todosLosDias) {
                const activo = entity.dias.includes(dia);
                await pool.query(
                    'INSERT INTO garage_dias (id_garage, dia, activo) VALUES ($1, $2, $3) ON CONFLICT (id_garage, dia) DO UPDATE SET activo = $3',
                    [garage.id, dia, activo]
                );
            }
        }
        return garage;
    }

    createWithClientAsync = async (entity, client) => {
        const result = await client.query(
            `INSERT INTO garages (nombre, piso, ubicacion, latitud, longitud, estado, capacidad,
                capacidad_para_no_reservas, capacidad_reservas, ocupacion_reservas, ocupacion_no_reservas,
                hora_apertura, hora_cierre, precio_pickup, precio_auto, precio_moto)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10,$11,$12,$13,$14) RETURNING *`,
            [entity.nombre, entity.piso ?? null, entity.ubicacion, entity.latitud ?? null,
             entity.longitud ?? null, entity.estado ?? true, entity.capacidad, entity.capacidad_para_no_reservas ?? null,
             entity.capacidad_reservas ?? null, entity.hora_apertura ?? null, entity.hora_cierre ?? null,
             entity.precio_pickup ?? null, entity.precio_auto ?? null, entity.precio_moto ?? null]
        );
        const garage = result.rows[0];
        for (const dia of getDiasSemana()) {
            await client.query(
                'INSERT INTO garage_dias (id_garage, dia, activo) VALUES ($1,$2,$3) ON CONFLICT (id_garage,dia) DO UPDATE SET activo=$3',
                [garage.id, dia, entity.dias.includes(dia)]
            );
        }
        return garage;
    };

    createPropioWithClientAsync = async (entity, client) => {
        const result = await client.query(
            `INSERT INTO garages (nombre, piso, ubicacion, latitud, longitud, estado, capacidad,
                capacidad_para_no_reservas, capacidad_reservas, ocupacion_reservas, ocupacion_no_reservas,
                hora_apertura, hora_cierre, precio_pickup, precio_auto, precio_moto, id_sede_propia)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10,$11,$12,$13,$14,$15) RETURNING *`,
            [entity.nombre, entity.piso, entity.ubicacion, entity.latitud ?? null,
             entity.longitud ?? null, entity.estado ?? true, entity.capacidad,
             entity.capacidad_para_no_reservas, entity.capacidad_reservas,
             entity.hora_apertura, entity.hora_cierre, entity.precio_pickup ?? null,
             entity.precio_auto ?? null, entity.precio_moto ?? null, entity.id_sede_propia]
        );
        const garage = result.rows[0];
        for (const dia of getDiasSemana()) {
            await client.query(
                'INSERT INTO garage_dias (id_garage, dia, activo) VALUES ($1,$2,$3) ON CONFLICT (id_garage,dia) DO UPDATE SET activo=$3',
                [garage.id, dia, entity.dias.includes(dia)]
            );
        }
        return garage;
    };

    updateAsync = async (id, entity) => {
        let result;
        result = await pool.query(
        `UPDATE garages SET 
            nombre=$1,
            piso=$2,
            ubicacion=$3,
            latitud=$4,
            longitud=$5,
            estado=$6,
            capacidad=$7,
            capacidad_para_no_reservas=$8,
            capacidad_reservas=$9,
            ocupacion_reservas = $10,
            ocupacion_no_reservas = $11,
            hora_apertura=$12,
            hora_cierre=$13,
            precio_pickup=$14,
            precio_auto=$15,
            precio_moto=$16
         WHERE id=$17
           AND COALESCE("Borrado", false) = false
         RETURNING *`,
        [
            entity.nombre, 
            entity.piso, 
            entity.ubicacion, 
            entity.latitud ?? null,
            entity.longitud ?? null,
            entity.estado,
            entity.capacidad, 
            entity.capacidad_para_no_reservas, 
            entity.capacidad_reservas, 
            entity.ocupacion_reservas, 
            entity.ocupacion_no_reservas,
            entity.hora_apertura,
            entity.hora_cierre,
            entity.precio_pickup ?? null,
            entity.precio_auto ?? null,
            entity.precio_moto ?? null,
            id
        ]
        );

        const garage = result.rows[0] ?? null;
        if (garage && entity.dias) {
            const todosLosDias = getDiasSemana();
            for (const dia of todosLosDias) {
                const activo = entity.dias.includes(dia);
                await pool.query(
                    'INSERT INTO garage_dias (id_garage, dia, activo) VALUES ($1, $2, $3) ON CONFLICT (id_garage, dia) DO UPDATE SET activo = $3',
                    [id, dia, activo]
                );
            }
        }
        return garage;
    }

    deleteAsync = async (id) => {
        const result = await pool.query(
            `UPDATE garages
             SET "Borrado" = true
             WHERE id = $1
               AND COALESCE("Borrado", false) = false`,
            [id]
        );
        return result.rowCount > 0;
    }

    restoreAsync = async (id, requestingUser = null) => {
        let accessSql = '';
        const params = [id];
        if (requestingUser && !hasRole(requestingUser, 4, ROLE_NAMES.SUPERADMIN)) {
            if (hasRole(requestingUser, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.GARAGISTA)) {
                params.push(requestingUser?.id);
                accessSql = ` AND EXISTS (SELECT 1 FROM usuario_garage ug WHERE ug.id_usuario = $${params.length} AND ug.id_garage = g.id)`;
            } else {
                params.push(requestingUser?.id_empresa);
                accessSql = ` AND EXISTS (SELECT 1 FROM trato_empresa_garage teg JOIN sedes ts ON ts.id=teg.id_sede WHERE ts.id_empresa = $${params.length} AND teg.id_garage = g.id`;
                if (requestingUser?.id_sede) {
                    params.push(requestingUser.id_sede);
                    accessSql += ` AND teg.id_sede = $${params.length}`;
                }
                accessSql += ' AND COALESCE(teg."Borrado", false) = false)';
            }
        }
        const result = await pool.query(
            `UPDATE garages g
             SET "Borrado" = false
             WHERE g.id = $1
               AND COALESCE(g."Borrado", false) = true ${accessSql}
             RETURNING g.*`,
            params
        );
        return result.rows[0] ?? null;
    }

    incrementOcupacionReservasAsync = async (id) => {
        const result = await pool.query(
            'UPDATE garages SET ocupacion_reservas = COALESCE(ocupacion_reservas, 0) + 1 WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
            [id]
        );
        return result.rows[0] ?? null;
    }

    incrementOcupacionReservasWithClientAsync = async (id, client) => {
        const result = await client.query(
            `UPDATE garages
             SET ocupacion_reservas = COALESCE(ocupacion_reservas, 0) + 1
             WHERE id = $1
               AND estado IS DISTINCT FROM false
               AND COALESCE("Borrado", false) = false
               AND COALESCE(ocupacion_reservas, 0) < COALESCE(capacidad_reservas, capacidad, 0)
             RETURNING *`,
            [id]
        );
        return result.rows[0] ?? null;
    }

    decrementOcupacionReservasAsync = async (id) => {
        const result = await pool.query(
            'UPDATE garages SET ocupacion_reservas = GREATEST(0, COALESCE(ocupacion_reservas, 0) - 1) WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
            [id]
        );
        return result.rows[0] ?? null;
    }

    decrementOcupacionReservasWithClientAsync = async (id, client) => {
        const result = await client.query(
            `UPDATE garages
             SET ocupacion_reservas = COALESCE(ocupacion_reservas, 0) - 1
             WHERE id = $1
               AND COALESCE("Borrado", false) = false
               AND COALESCE(ocupacion_reservas, 0) > 0
             RETURNING *`,
            [id]
        );
        return result.rows[0] ?? null;
    }

    lockOccupancyActorAsync = async (scope, client) => {
        if (!isGarageOccupancyScope(scope)) return null;
        return (await client.query(`SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.id_rol
            WHERE u.id=$1 AND u.id_rol=$2 AND COALESCE(u.activo,true)=true
            AND COALESCE(u."Borrado",false)=false AND COALESCE(r."Borrado",false)=false
            AND ($2::integer<>1 OR (u.id_empresa=$3::integer AND u.id_sede IS NOT DISTINCT FROM $4::integer))
            FOR SHARE OF u,r`, [scope.actorId, scope.roleId, scope.companyId ?? null, scope.siteId ?? null])).rows[0] ?? null;
    }

    getForNoReservationOccupancyAsync = async (id, scope, client) => {
        if (!isGarageOccupancyScope(scope)) return null;
        if (scope.kind === 'assigned') {
            // FOR SHARE tambien impide DELETE/UPDATE de la asignacion hasta COMMIT.
            const assignment = await client.query(`SELECT id_usuario FROM usuario_garage
                WHERE id_usuario=$1 AND id_garage=$2 FOR SHARE`, [scope.actorId, id]);
            if (!assignment.rows.length) return null;
        }
        const filter = occupancyFilter(scope);
        const garage = (await client.query(`SELECT g.* FROM garages g WHERE g.id=$1
            AND COALESCE(g."Borrado",false)=false ${filter.sql} FOR UPDATE OF g`, [id, ...filter.params])).rows[0];
        if (!garage) return null;
        if (scope.kind === 'owned') {
            // g permanece bloqueado: id_sede_propia no cambia. Revalidar s despues
            // de bloquearla detecta transferencias/bajas previas y evita posteriores.
            const site = await client.query(`SELECT id FROM sedes WHERE id=$1 AND id_empresa=$2
                AND ($3::integer IS NULL OR id=$3) AND COALESCE("Borrado",false)=false FOR SHARE`,
            [garage.id_sede_propia, scope.companyId, scope.siteId]);
            if (!site.rows.length) return null;
        }
        return garage;
    }

    incrementOcupacionNoReservasAsync = async (id, scope, client = pool) => {
        const filter = occupancyFilter(scope);
        return (await client.query(`UPDATE garages g SET ocupacion_no_reservas=COALESCE(g.ocupacion_no_reservas,0)+1
            WHERE g.id=$1 AND COALESCE(g."Borrado",false)=false ${filter.sql}
            AND COALESCE(g.ocupacion_no_reservas,0)>=0
            AND COALESCE(g.ocupacion_no_reservas,0)<COALESCE(g.capacidad_para_no_reservas,g.capacidad,0)
            AND COALESCE(g.ocupacion_no_reservas,0)+COALESCE(g.ocupacion_reservas,0)<COALESCE(g.capacidad,0)
            RETURNING g.*`, [id, ...filter.params])).rows[0] ?? null;
    }

    decrementOcupacionNoReservasAsync = async (id, scope, client = pool) => {
        const filter = occupancyFilter(scope);
        // Compatibilidad: egresar estando en cero responde 200 y mantiene cero.
        return (await client.query(`UPDATE garages g SET ocupacion_no_reservas=GREATEST(0,COALESCE(g.ocupacion_no_reservas,0)-1)
            WHERE g.id=$1 AND COALESCE(g."Borrado",false)=false ${filter.sql} RETURNING g.*`,
        [id, ...filter.params])).rows[0] ?? null;
    }

    getDiasAsync = async (id_garage) => {
        const result = await pool.query(
            'SELECT dia FROM garage_dias WHERE id_garage = $1 AND activo = true ORDER BY dia',
            [id_garage]
        );
        return result.rows.map(r => r.dia);
    }

    addDiaAsync = async (id_garage, dia) => {
        const result = await pool.query(
            'INSERT INTO garage_dias (id_garage, dia, activo) VALUES ($1, $2, true) ON CONFLICT (id_garage, dia) DO UPDATE SET activo = true WHERE garage_dias.activo = false RETURNING *',
            [id_garage, dia]
        );
        return result.rows[0] ?? null;
    }

    removeDiaAsync = async (id_garage, dia) => {
        const result = await pool.query(
            'UPDATE garage_dias SET activo = false WHERE id_garage = $1 AND dia = $2 RETURNING *',
            [id_garage, dia]
        );
        return result.rowCount > 0;
    }

    getCercanosAsync = async (lat, lng, radioKm, sedeId) => {
        const result = await pool.query(`
            SELECT g.*, COALESCE((SELECT array_agg(gd.dia::text ORDER BY gd.dia) FROM garage_dias gd WHERE gd.id_garage=g.id AND gd.activo=true), '{}'::text[]) AS dias,
              GREATEST(0, COALESCE(g.capacidad,0) - COALESCE((SELECT SUM(t.cantidad_cocheras) FROM trato_empresa_garage t WHERE t.id_garage=g.id AND COALESCE(t."Borrado", false)=false),0)) AS cocheras_disponibles,
              EXISTS(SELECT 1 FROM trato_empresa_garage ts WHERE ts.id_garage=g.id AND ts.id_sede=$4 AND COALESCE(ts."Borrado", false)=false) AS ya_contratado, (
                6371 * acos(
                    cos(radians($1)) * cos(radians(latitud)) *
                    cos(radians(longitud) - radians($2)) +
                    sin(radians($1)) * sin(radians(latitud))
                )
            ) AS distance
            FROM garages g
            WHERE g.latitud IS NOT NULL
              AND g.longitud IS NOT NULL
              AND g.estado IS DISTINCT FROM false
              AND COALESCE("Borrado", false) = false
              AND g.id_sede_propia IS NULL
              AND (
                6371 * acos(
                    cos(radians($1)) * cos(radians(latitud)) *
                    cos(radians(longitud) - radians($2)) +
                    sin(radians($1)) * sin(radians(latitud))
                )
              ) < $3
            ORDER BY distance
        `, [lat, lng, radioKm, sedeId]);
        return result.rows;
    }
}

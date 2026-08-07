// garageRepository.js
import pool from '../database/db.js';
import { getDiasSemana } from '../helpers/validatorHelper.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';

export default class GarageRepository {
    constructor() {
        console.log('Estoy en: GarageRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        try {
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
                    accessSql += ')';
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
        } catch (error) { console.error(error); return null; }
    }

    getByIdAsync = async (id, requestingUser = null) => {
        try {
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
                    accessSql += ')';
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
        } catch (error) { console.error(error); return null; }
    }

    getByIdForUpdateWithClientAsync = async (id, client) => {
        const result = await client.query('SELECT * FROM garages WHERE id = $1 AND COALESCE("Borrado", false) = false FOR UPDATE', [id]);
        return result.rows[0] ?? null;
    }

    getOcupacionReservaAsync = async (id) => {
        try {
            const result = await pool.query('SELECT ocupacion_reservas FROM garages WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    getOcupacionNoReservaAsync = async (id) => {
        try {
            const result = await pool.query('SELECT ocupacion_no_reservas FROM garages WHERE id = $1 AND COALESCE("Borrado", false) = false', [id]);
            return result.rows;
        } catch (error) { console.error(error); return null; }
    }

    createAsync = async (entity) => {
        try {
            const result = await pool.query(
                `INSERT INTO garages (id_sede, nombre, piso, ubicacion, latitud, longitud, estado, capacidad, capacidad_para_no_reservas, capacidad_reservas, ocupacion_reservas, ocupacion_no_reservas, hora_apertura, hora_cierre, precio_pickup, precio_auto, precio_moto)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
                [entity.id_sede, entity.nombre, entity.piso, entity.ubicacion, entity.latitud ?? null, entity.longitud ?? null, entity.estado,
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
        } catch (error) { console.error(error); return null; }
    }

    createWithClientAsync = async (entity, client) => {
        const result = await client.query(
            `INSERT INTO garages (id_sede, nombre, piso, ubicacion, latitud, longitud, estado, capacidad,
                capacidad_para_no_reservas, capacidad_reservas, ocupacion_reservas, ocupacion_no_reservas,
                hora_apertura, hora_cierre, precio_pickup, precio_auto, precio_moto)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,$11,$12,$13,$14,$15) RETURNING *`,
            [entity.id_sede ?? null, entity.nombre, entity.piso ?? null, entity.ubicacion, entity.latitud ?? null,
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

    updateAsync = async (id, entity) => {
        let result;
        try {
            result = await pool.query(
            `UPDATE garages SET 
                id_sede=$1, 
                nombre=$2, 
                piso=$3, 
                ubicacion=$4, 
                latitud=$5,
                longitud=$6,
                estado=$7,
                capacidad=$8, 
                capacidad_para_no_reservas=$9, 
                capacidad_reservas=$10, 
                ocupacion_reservas = $11, 
                ocupacion_no_reservas = $12,
                hora_apertura=$13,
                hora_cierre=$14,
                precio_pickup=$15,
                precio_auto=$16,
                precio_moto=$17
             WHERE id=$18
               AND COALESCE("Borrado", false) = false
             RETURNING *`,
            [
                entity.id_sede, 
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
        } catch (error) { console.error(error); return null; }
    }

    deleteAsync = async (id) => {
        try {
            const result = await pool.query(
                `UPDATE garages
                 SET "Borrado" = true
                 WHERE id = $1
                   AND COALESCE("Borrado", false) = false`,
                [id]
            );
            return result.rowCount > 0;
        } catch (error) { console.error(error); return false; }
    }

    incrementOcupacionReservasAsync = async (id) => {
        try {
            const result = await pool.query(
                'UPDATE garages SET ocupacion_reservas = COALESCE(ocupacion_reservas, 0) + 1 WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
                [id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
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
        try {
            const result = await pool.query(
                'UPDATE garages SET ocupacion_reservas = GREATEST(0, COALESCE(ocupacion_reservas, 0) - 1) WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
                [id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
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

    incrementOcupacionNoReservasAsync = async (id) => {
        try {
            const result = await pool.query(
                'UPDATE garages SET ocupacion_no_reservas = COALESCE(ocupacion_no_reservas, 0) + 1 WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
                [id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    decrementOcupacionNoReservasAsync = async (id) => {
        try {
            const result = await pool.query(
                'UPDATE garages SET ocupacion_no_reservas = GREATEST(0, COALESCE(ocupacion_no_reservas, 0) - 1) WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
                [id]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    getDiasAsync = async (id_garage) => {
        try {
            const result = await pool.query(
                'SELECT dia FROM garage_dias WHERE id_garage = $1 AND activo = true ORDER BY dia',
                [id_garage]
            );
            return result.rows.map(r => r.dia);
        } catch (error) { console.error(error); return null; }
    }

    addDiaAsync = async (id_garage, dia) => {
        try {
            const result = await pool.query(
                'INSERT INTO garage_dias (id_garage, dia, activo) VALUES ($1, $2, true) ON CONFLICT (id_garage, dia) DO UPDATE SET activo = true RETURNING *',
                [id_garage, dia]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); return null; }
    }

    removeDiaAsync = async (id_garage, dia) => {
        try {
            const result = await pool.query(
                'UPDATE garage_dias SET activo = false WHERE id_garage = $1 AND dia = $2 RETURNING *',
                [id_garage, dia]
            );
            return result.rowCount > 0;
        } catch (error) { console.error(error); return false; }
    }

    getCercanosAsync = async (lat, lng, radioKm, sedeId) => {
        try {
            const result = await pool.query(`
                SELECT g.*, COALESCE((SELECT array_agg(gd.dia::text ORDER BY gd.dia) FROM garage_dias gd WHERE gd.id_garage=g.id AND gd.activo=true), '{}'::text[]) AS dias,
                  GREATEST(0, COALESCE(g.capacidad,0) - COALESCE((SELECT SUM(t.cantidad_cocheras) FROM trato_empresa_garage t WHERE t.id_garage=g.id),0)) AS cocheras_disponibles,
                  EXISTS(SELECT 1 FROM trato_empresa_garage ts WHERE ts.id_garage=g.id AND ts.id_sede=$4) AS ya_contratado, (
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
        } catch (error) { console.error(error); return null; }
    }
}

// reservaRepository.js
import pool from '../database/db.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';

const withoutQrToken = (row) => {
    if (!row) return row;
    const { qr_token, ...safeRow } = row;
    return safeRow;
};

const withoutQrTokens = (rows) => rows.map(withoutQrToken);

export default class ReservaRepository {
    constructor() {
        console.log('Estoy en: ReservaRepository.constructor()');
    }

    expirePendingAsync = async (client = pool, id = null) => (await client.query(
        `UPDATE reservas SET estado_reserva='expirada'
          WHERE estado_reserva='pendiente_pago' AND retencion_pago_hasta<=NOW()
            AND ($1::bigint IS NULL OR id=$1) RETURNING id`, [id]
    )).rowCount;

    quoteAndCreateWithClientAsync = async (entity, client, insert = true) => {
        await this.expirePendingAsync(client);
        const user = (await client.query(
            `SELECT u.id,u.id_sede,COALESCE(u.id_empresa,s.id_empresa) AS id_empresa
               FROM usuarios u
               LEFT JOIN sedes s ON s.id=u.id_sede AND COALESCE(s."Borrado",false)=false
              WHERE u.id=$1 AND COALESCE(u.activo,true)=true
                AND COALESCE(u."Borrado",false)=false`,
            [entity.id_usuario]
        )).rows[0];
        if (!user) throw Object.assign(new Error('El empleado no existe o esta inactivo.'), { statusCode: 403 });
        if (!user.id_sede) throw Object.assign(new Error('El empleado no tiene una sede asignada.'), { statusCode: 409 });
        if (!user.id_empresa) throw Object.assign(new Error('La sede del empleado no pertenece a una empresa activa.'), { statusCode: 409 });
        const vehicle = (await client.query(`SELECT id,tipo_vehiculo::text tipo_vehiculo FROM vehiculos WHERE id=$1 AND id_usuario=$2 AND COALESCE("Borrado",false)=false`, [entity.id_vehiculo,user.id])).rows[0];
        if (!vehicle) throw Object.assign(new Error('El vehiculo no pertenece al empleado autenticado.'), { statusCode: 403 });
        const garage = (await client.query(`SELECT id,capacidad,estado FROM garages WHERE id=$1 AND COALESCE("Borrado",false)=false FOR UPDATE`, [entity.id_garage])).rows[0];
        if (!garage || garage.estado === false) throw Object.assign(new Error('El garage no existe o no esta activo.'), { statusCode: 404 });
        const trato = (await client.query(`SELECT * FROM trato_empresa_garage WHERE id_sede=$1 AND id_garage=$2 AND COALESCE("Borrado",false)=false FOR UPDATE`, [user.id_sede,entity.id_garage])).rows[0];
        if (!trato) throw Object.assign(new Error('No existe un trato activo para la sede y el garage.'), { statusCode: 409 });
        // Las columnas fecha_entrada/fecha_salida son timestamp SIN zona horaria
        // y guardan hora local de Argentina. Comparar naive-vs-naive (los casts
        // ::timestamptz promueven el naive usando el timezone de la sesion de
        // Supabase (UTC) y corrian los solapes 3 horas).
        const active = `COALESCE("Borrado",false)=false AND (estado_reserva='confirmada' OR (estado_reserva='pendiente_pago' AND retencion_pago_hasta>NOW())) AND fecha_entrada<$2::timestamp AND fecha_salida>$1::timestamp`;
        if ((await client.query(`SELECT 1 FROM reservas WHERE (id_usuario=$3 OR id_vehiculo=$4) AND ${active} LIMIT 1`, [entity.fecha_entrada,entity.fecha_salida,user.id,vehicle.id])).rowCount) throw Object.assign(new Error('El empleado o vehiculo ya tiene una reserva en ese intervalo.'), { statusCode: 409 });
        const counts = (await client.query(`SELECT COUNT(*) FILTER (WHERE id_trato=$4)::int trato,COUNT(*)::int garage FROM reservas WHERE id_garage=$3 AND ${active}`, [entity.fecha_entrada,entity.fecha_salida,entity.id_garage,trato.id])).rows[0];
        if (Number(counts.garage)>=Number(garage.capacidad)) throw Object.assign(new Error('El garage no tiene capacidad general disponible.'), { statusCode: 409 });
        const tipoCupo = Number(counts.trato)<Number(trato.cantidad_cocheras)?'dentro_cupo':'extra';
        const responsable = trato.modalidad_pago==='empresa_cubre_cupo'&&tipoCupo==='dentro_cupo'?'empresa':'empleado';
        const column = {auto:'precio_auto',moto:'precio_moto',pickup:'precio_pickup'}[vehicle.tipo_vehiculo];
        const tarifa = Number(trato[column]);
        if (!column||!Number.isFinite(tarifa)||tarifa<0) throw Object.assign(new Error('El trato no tiene una tarifa valida para el vehiculo.'), { statusCode: 409 });
        const minutos=Math.round((new Date(entity.fecha_salida)-new Date(entity.fecha_entrada))/60000);
        const importe=Number((tarifa*minutos/60).toFixed(2));
        const snap={id_trato:trato.id,modalidad_pago_aplicada:trato.modalidad_pago,tipo_cupo:tipoCupo,responsable_pago:responsable,tarifa_hora_aplicada:tarifa,importe_estimado:importe,estado_reserva:responsable==='empresa'?'confirmada':'pendiente_pago',retencion_pago_hasta:responsable==='empresa'?null:new Date(Date.now()+600000)};
        if (!insert) return {idTrato:trato.id,modalidadPago:trato.modalidad_pago,tipoCupo,responsablePago:responsable,tipoVehiculo:vehicle.tipo_vehiculo,tarifaHora:tarifa,minutos,importe,requierePago:responsable==='empleado'};
        return withoutQrToken((await client.query(
            `INSERT INTO reservas
                (id_usuario,id_garage,id_vehiculo,fecha_entrada,fecha_salida,entro,salio,dia,
                 id_trato,modalidad_pago_aplicada,tipo_cupo,responsable_pago,
                 tarifa_hora_aplicada,importe_estimado,estado_reserva,retencion_pago_hasta)
             VALUES
                ($1,$2,$3,$4,$5,false,false,$6,$7,$8,$9,$10,$11,$12,
                 $13::estado_reserva_enum,$14)
             RETURNING *`,
            [
                user.id,
                entity.id_garage,
                vehicle.id,
                entity.fecha_entrada,
                entity.fecha_salida,
                entity.dia,
                snap.id_trato,
                snap.modalidad_pago_aplicada,
                snap.tipo_cupo,
                snap.responsable_pago,
                snap.tarifa_hora_aplicada,
                snap.importe_estimado,
                snap.estado_reserva,
                snap.retencion_pago_hasta,
            ]
        )).rows[0]);
    };

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
            return withoutQrTokens(result.rows);
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
            return withoutQrTokens(result.rows);
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
            return withoutQrToken(result.rows[0] ?? null);
        } catch (error) { console.error(error); return null; }
    }

    getQrByIdAsync = async (id) => {
        const result = await pool.query(
            `SELECT id, id_usuario, fecha_salida, entro, salio, "Borrado", estado_reserva, qr_token
               FROM reservas
              WHERE id = $1`,
            [id]
        );
        return result.rows[0] ?? null;
    }

    getByQrTokenAsync = async (qrToken) => {
        const result = await pool.query(
            `SELECT r.id, v.patente
               FROM reservas r
               INNER JOIN vehiculos v ON v.id = r.id_vehiculo
              WHERE r.qr_token = $1::uuid
                AND COALESCE(r."Borrado", false) = false`,
            [qrToken]
        );
        return result.rows[0] ?? null;
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
        return withoutQrToken(result.rows[0] ?? null);
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
            return withoutQrTokens(result.rows);
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
                    r.modalidad_pago_aplicada,
                    r.tipo_cupo,
                    r.responsable_pago,
                    r.tarifa_hora_aplicada,
                    r.importe_estimado,
                    r.estado_reserva,
                    r.retencion_pago_hasta,
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
            return withoutQrTokens(result.rows);
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
            return withoutQrTokens(result.rows);
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
            return withoutQrTokens(result.rows);
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
            return withoutQrTokens(result.rows);
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
            return withoutQrTokens(result.rows);
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
            return withoutQrTokens(result.rows);
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
            return withoutQrToken(result.rows[0]);
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
            return withoutQrToken(result.rows[0] ?? null);
        } catch (error) { console.error(error); return null; }
    }

    createWithClientAsync = async (entity, client) => {
        const result = await client.query(
            `INSERT INTO reservas (id_usuario, id_garage, id_vehiculo, fecha_entrada, fecha_salida, entro, salio, dia)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [entity.id_usuario, entity.id_garage, entity.id_vehiculo,
             entity.fecha_entrada, entity.fecha_salida, entity.entro, entity.salio, entity.dia]
        );
        return withoutQrToken(result.rows[0]);
    }

    cancelarWithClientAsync = async (id, client) => {
        const result = await client.query(
            'UPDATE reservas SET "Borrado" = true WHERE id = $1 AND COALESCE("Borrado", false) = false RETURNING *',
            [id]
        );
        return withoutQrToken(result.rows[0] ?? null);
    }

    updateWithClientAsync = async (id, entity, client) => {
        const result = await client.query(
            `UPDATE reservas SET id_usuario=$1, id_garage=$2, id_vehiculo=$3,
             fecha_entrada=$4, fecha_salida=$5, entro=$6, salio=$7, dia=$8 WHERE id=$9 AND COALESCE("Borrado", false) = false RETURNING *`,
            [entity.id_usuario, entity.id_garage, entity.id_vehiculo,
             entity.fecha_entrada, entity.fecha_salida, entity.entro, entity.salio, entity.dia, id]
        );
        return withoutQrToken(result.rows[0] ?? null);
    }

    registrarIngresoWithClientAsync = async (id, client) => {
        const result = await client.query(
            'UPDATE reservas SET entro = true WHERE id = $1 AND COALESCE(entro, false) = false AND COALESCE(salio, false) = false AND COALESCE("Borrado", false) = false RETURNING *',
            [id]
        );
        return withoutQrToken(result.rows[0] ?? null);
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
        return withoutQrToken(result.rows[0] ?? null);
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
            return withoutQrTokens(result.rows);
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

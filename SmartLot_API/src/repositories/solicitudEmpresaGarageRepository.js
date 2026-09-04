import pool from '../database/db.js';
import TratoEmpresaGarageRepository from './tratoEmpresaGarageRepository.js';
import { ESTADOS_SOLICITUD } from '../helpers/estadosSolicitud.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

const DETAIL_SELECT = `
    SELECT so.*, s.id_empresa AS id_empresa,
           s.nombre AS sede_nombre, s.ubicacion AS sede_ubicacion,
           e.nombre AS empresa_nombre,
           g.nombre AS garage_nombre, g.ubicacion AS garage_ubicacion,
           g.capacidad AS garage_capacidad, g.estado AS garage_estado,
           g.precio_auto, g.precio_moto, g.precio_pickup,
           GREATEST(0, COALESCE(g.capacidad,0) - COALESCE((
               SELECT SUM(t.cantidad_cocheras) FROM trato_empresa_garage t WHERE t.id_garage=so.id_garage
           ),0)) AS capacidad_disponible,
           (CASE WHEN so.tipo_solicitud = 'modificacion' AND so.id_trato IS NOT NULL
                 THEN (SELECT t2.cantidad_cocheras FROM trato_empresa_garage t2 WHERE t2.id=so.id_trato)
                 ELSE NULL END) AS cantidad_actual_trato,
           (SELECT STRING_AGG(ud.nombre || ' ' || ud.apellido, ', ')
              FROM usuario_garage ug2
              JOIN usuarios ud ON ud.id = ug2.id_usuario
             WHERE ug2.id_garage = so.id_garage AND COALESCE(ud."Borrado", false) = false
           ) AS duenio_nombre
      FROM solicitudes so
      JOIN sedes s ON s.id=so.id_sede
      JOIN empresas e ON e.id=s.id_empresa
      JOIN garages g ON g.id=so.id_garage`;

export default class SolicitudEmpresaGarageRepository {
    constructor() {
        this.pool = pool;
        this.tratoRepo = new TratoEmpresaGarageRepository();
    }

    createPendingAsync = async (entity) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const sede = (await client.query(
                `SELECT id, id_empresa FROM sedes
                  WHERE id=$1 AND COALESCE("Borrado",false)=false`, [entity.id_sede]
            )).rows[0];
            if (!sede) fail('La sede no existe o esta inactiva.', 404);
            if (Number(sede.id_empresa) !== Number(entity.id_empresa_autorizada)) fail('La sede no pertenece a la empresa autenticada.', 403);
            const garage = (await client.query(
                'SELECT * FROM garages WHERE id=$1 FOR UPDATE', [entity.id_garage]
            )).rows[0];
            if (!garage || garage.Borrado === true) fail('El garage no existe.', 404);
            if (garage.estado === false) fail('El garage no esta activo.', 409);
            if (entity.tipo_solicitud !== 'modificacion' && await this.tratoRepo.getBySedeGarageWithClientAsync(entity.id_sede, entity.id_garage, client)) {
                fail('Ya existe un trato entre la sede y el garage.', 409);
            }
            const pending = (await client.query(
                `SELECT id FROM solicitudes
                  WHERE id_sede=$1 AND id_garage=$2 AND estado=$3 AND tipo_solicitud='nueva'
                  LIMIT 1`, [entity.id_sede, entity.id_garage, ESTADOS_SOLICITUD.PENDIENTE]
            )).rows[0];
            if (pending) fail('Ya existe una solicitud pendiente para esa sede y garage.', 409);
            const comprometidas = await this.tratoRepo.sumCantidadByGarageWithClientAsync(entity.id_garage, client);
            if (entity.cantidad_cocheras > Number(garage.capacidad) - comprometidas) {
                fail('La cantidad solicitada supera las cocheras disponibles.', 409);
            }
            const result = await client.query(
                `INSERT INTO solicitudes (id_sede,id_garage,descripcion,cantidad_cocheras,estado,tipo_solicitud,id_trato)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [entity.id_sede, entity.id_garage, entity.descripcion, entity.cantidad_cocheras,
                 ESTADOS_SOLICITUD.PENDIENTE, entity.tipo_solicitud || 'nueva', entity.id_trato || null]
            );
            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    };

    getSentByEmpresaAsync = async (idEmpresa, idSede = null) => (await this.pool.query(
        `${DETAIL_SELECT} WHERE s.id_empresa=$1 AND ($2::int IS NULL OR so.id_sede=$2) ORDER BY so.created_at DESC`,
        [idEmpresa, idSede]
    )).rows;

    getReceivedByOwnerAsync = async (idUsuario) => (await this.pool.query(
        `${DETAIL_SELECT}
          WHERE EXISTS (SELECT 1 FROM usuario_garage ug WHERE ug.id_usuario=$1 AND ug.id_garage=so.id_garage)
          ORDER BY so.created_at DESC`, [idUsuario]
    )).rows;

    getByIdAsync = async (id) => (await this.pool.query(
        `${DETAIL_SELECT} WHERE so.id=$1`, [id]
    )).rows[0] ?? null;

    ownerHasGarageAsync = async (idUsuario, idGarage) => (await this.pool.query(
        'SELECT 1 FROM usuario_garage WHERE id_usuario=$1 AND id_garage=$2 LIMIT 1', [idUsuario, idGarage]
    )).rowCount > 0;

    acceptAsync = async (id, idUsuario) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no esta pendiente.', 409);
            if (solicitud.tipo_solicitud !== 'nueva') fail('Use el endpoint de autorización para solicitudes de modificación.', 400);
            const owns = (await client.query(
                'SELECT 1 FROM usuario_garage WHERE id_usuario=$1 AND id_garage=$2 LIMIT 1',
                [idUsuario, solicitud.id_garage]
            )).rowCount > 0;
            if (!owns) fail('No tiene permisos sobre el garage de la solicitud.', 403);
            const sede = (await client.query(
                `SELECT id, id_empresa FROM sedes WHERE id=$1 AND COALESCE("Borrado",false)=false`, [solicitud.id_sede]
            )).rows[0];
            if (!sede) fail('La sede no existe o esta inactiva.', 409);
            const garage = (await client.query(
                'SELECT * FROM garages WHERE id=$1 AND COALESCE("Borrado",false)=false FOR UPDATE', [solicitud.id_garage]
            )).rows[0];
            if (!garage) fail('El garage no existe.', 404);
            if (garage.estado === false) fail('El garage no esta activo.', 409);
            if (await this.tratoRepo.getBySedeGarageWithClientAsync(solicitud.id_sede, solicitud.id_garage, client)) {
                fail('Ya existe un trato entre la sede y el garage.', 409);
            }
            const comprometidas = await this.tratoRepo.sumCantidadByGarageWithClientAsync(solicitud.id_garage, client);
            if (Number(solicitud.cantidad_cocheras) > Number(garage.capacidad) - comprometidas) {
                fail('La cantidad solicitada supera las cocheras disponibles.', 409);
            }
            const trato = await this.tratoRepo.createWithClientAsync({
                id_sede: solicitud.id_sede,
                id_garage: solicitud.id_garage,
                cantidad_cocheras: solicitud.cantidad_cocheras,
                precio_auto: Number(garage.precio_auto ?? 0),
                precio_moto: Number(garage.precio_moto ?? 0),
                precio_pickup: Number(garage.precio_pickup ?? 0),
            }, client);
            const updated = await client.query(
                'UPDATE solicitudes SET estado=$1 WHERE id=$2 AND estado=$3 RETURNING *',
                [ESTADOS_SOLICITUD.ACEPTADA, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no esta pendiente.', 409);
            await client.query('COMMIT');
            return { solicitud: updated.rows[0], trato };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') fail('Ya existe un trato entre la sede y el garage.', 409);
            throw error;
        } finally { client.release(); }
    };

    rejectAsync = async (id, idUsuario) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no esta pendiente.', 409);
            if (solicitud.tipo_solicitud !== 'nueva') fail('Use el endpoint de rechazo de modificación para solicitudes de modificación.', 400);
            const owns = (await client.query(
                'SELECT 1 FROM usuario_garage WHERE id_usuario=$1 AND id_garage=$2 LIMIT 1', [idUsuario, solicitud.id_garage]
            )).rowCount > 0;
            if (!owns) fail('No tiene permisos sobre el garage de la solicitud.', 403);
            const updated = await client.query(
                'UPDATE solicitudes SET estado=$1 WHERE id=$2 AND estado=$3 RETURNING *',
                [ESTADOS_SOLICITUD.RECHAZADA, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no esta pendiente.', 409);
            await client.query('COMMIT');
            return updated.rows[0];
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };

    cancelAsync = async (id, idEmpresa, idSede = null) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query(
                `SELECT so.*, s.id_empresa FROM solicitudes so
                  JOIN sedes s ON s.id=so.id_sede WHERE so.id=$1 FOR UPDATE OF so`, [id]
            )).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (Number(solicitud.id_empresa) !== Number(idEmpresa) || (idSede && Number(solicitud.id_sede) !== Number(idSede))) {
                fail('No tiene acceso a esta solicitud.', 403);
            }
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no esta pendiente.', 409);
            const updated = await client.query(
                'UPDATE solicitudes SET estado=$1 WHERE id=$2 AND estado=$3 RETURNING *',
                [ESTADOS_SOLICITUD.CANCELADA, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no esta pendiente.', 409);
            await client.query('COMMIT');
            return updated.rows[0];
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };

    acceptModificationAsync = async (id, idUsuario) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no esta pendiente.', 409);
            if (solicitud.tipo_solicitud !== 'modificacion') fail('Esta solicitud no es de modificación.', 400);
            if (!solicitud.id_trato) fail('La solicitud de modificación no tiene trato asociado.', 400);
            const owns = (await client.query(
                'SELECT 1 FROM usuario_garage WHERE id_usuario=$1 AND id_garage=$2 LIMIT 1',
                [idUsuario, solicitud.id_garage]
            )).rowCount > 0;
            if (!owns) fail('No tiene permisos sobre el garage de la solicitud.', 403);
            const trato = (await client.query(
                'SELECT * FROM trato_empresa_garage WHERE id=$1 FOR UPDATE', [solicitud.id_trato]
            )).rows[0];
            if (!trato) fail('El trato asociado no existe.', 404);
            const garage = (await client.query(
                'SELECT capacidad FROM garages WHERE id=$1 FOR UPDATE', [solicitud.id_garage]
            )).rows[0];
            if (!garage) fail('El garage no existe.', 404);
            const otros = Number((await client.query(
                'SELECT COALESCE(SUM(cantidad_cocheras),0) AS total FROM trato_empresa_garage WHERE id_garage=$1 AND id<>$2',
                [solicitud.id_garage, solicitud.id_trato]
            )).rows[0].total);
            const nuevaCantidad = Number(solicitud.cantidad_cocheras);
            if (otros + nuevaCantidad > Number(garage.capacidad)) {
                fail('La cantidad solicitada supera la capacidad disponible del garage.', 409);
            }
            await client.query(
                'UPDATE trato_empresa_garage SET cantidad_cocheras=$1 WHERE id=$2',
                [nuevaCantidad, solicitud.id_trato]
            );
            const updated = await client.query(
                'UPDATE solicitudes SET estado=$1 WHERE id=$2 AND estado=$3 RETURNING *',
                [ESTADOS_SOLICITUD.ACEPTADA, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no esta pendiente.', 409);
            await client.query('COMMIT');
            return { solicitud: updated.rows[0], trato };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') fail('Ya existe un trato para esa sede y garage.', 409);
            throw error;
        } finally { client.release(); }
    };

    rejectModificationAsync = async (id, idUsuario) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no esta pendiente.', 409);
            if (solicitud.tipo_solicitud !== 'modificacion') fail('Esta solicitud no es de modificación.', 400);
            const owns = (await client.query(
                'SELECT 1 FROM usuario_garage WHERE id_usuario=$1 AND id_garage=$2 LIMIT 1',
                [idUsuario, solicitud.id_garage]
            )).rowCount > 0;
            if (!owns) fail('No tiene permisos sobre el garage de la solicitud.', 403);
            const updated = await client.query(
                'UPDATE solicitudes SET estado=$1 WHERE id=$2 AND estado=$3 RETURNING *',
                [ESTADOS_SOLICITUD.RECHAZADA, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no esta pendiente.', 409);
            await client.query('COMMIT');
            return updated.rows[0];
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };
}

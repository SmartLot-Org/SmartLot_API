import pool from '../database/db.js';
import TratoEmpresaGarageRepository from './tratoEmpresaGarageRepository.js';
import { ESTADOS_SOLICITUD } from '../helpers/estadosSolicitud.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

const DETAIL_SELECT = `
    SELECT so.*, e.nombre AS empresa_nombre,
           g.nombre AS garage_nombre, g.ubicacion AS garage_ubicacion,
           g.capacidad AS garage_capacidad, g.estado AS garage_estado,
           g.precio_auto, g.precio_moto, g.precio_pickup,
           GREATEST(0, COALESCE(g.capacidad,0) - COALESCE((
               SELECT SUM(t.cantidad_cocheras) FROM trato_empresa_garage t WHERE t.id_garage=so.id_garage
           ),0)) AS capacidad_disponible
      FROM solicitudes so
      JOIN empresas e ON e.id=so.id_empresa
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
            const empresa = (await client.query(
                'SELECT id FROM empresas WHERE id=$1 AND COALESCE("Borrado",false)=false', [entity.id_empresa]
            )).rows[0];
            if (!empresa) fail('La empresa no existe o está inactiva.', 404);
            const garage = (await client.query(
                'SELECT * FROM garages WHERE id=$1 FOR UPDATE', [entity.id_garage]
            )).rows[0];
            if (!garage || garage.Borrado === true) fail('El garage no existe.', 404);
            if (garage.estado === false) fail('El garage no está activo.', 409);
            if (await this.tratoRepo.getByEmpresaGarageWithClientAsync(entity.id_empresa, entity.id_garage, client)) {
                fail('Ya existe un trato entre la empresa y el garage.', 409);
            }
            const pending = (await client.query(
                `SELECT id FROM solicitudes
                  WHERE id_empresa=$1 AND id_garage=$2 AND estado=$3
                  LIMIT 1`, [entity.id_empresa, entity.id_garage, ESTADOS_SOLICITUD.PENDIENTE]
            )).rows[0];
            if (pending) fail('Ya existe una solicitud pendiente para ese garage.', 409);
            const comprometidas = await this.tratoRepo.sumCantidadByGarageWithClientAsync(entity.id_garage, client);
            if (entity.cantidad_cocheras > Number(garage.capacidad) - comprometidas) {
                fail('La cantidad solicitada supera las cocheras disponibles.', 409);
            }
            const result = await client.query(
                `INSERT INTO solicitudes (id_empresa,id_garage,descripcion,cantidad_cocheras,estado)
                 VALUES ($1,$2,$3,$4,$5) RETURNING *`,
                [entity.id_empresa, entity.id_garage, entity.descripcion, entity.cantidad_cocheras, ESTADOS_SOLICITUD.PENDIENTE]
            );
            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    };

    getSentByEmpresaAsync = async (idEmpresa) => (await this.pool.query(
        `${DETAIL_SELECT} WHERE so.id_empresa=$1 ORDER BY so.created_at DESC`, [idEmpresa]
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
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no está pendiente.', 409);
            const owns = (await client.query(
                'SELECT 1 FROM usuario_garage WHERE id_usuario=$1 AND id_garage=$2 LIMIT 1',
                [idUsuario, solicitud.id_garage]
            )).rowCount > 0;
            if (!owns) fail('No tiene permisos sobre el garage de la solicitud.', 403);
            const garage = (await client.query(
                'SELECT * FROM garages WHERE id=$1 AND COALESCE("Borrado",false)=false FOR UPDATE', [solicitud.id_garage]
            )).rows[0];
            if (!garage) fail('El garage no existe.', 404);
            if (garage.estado === false) fail('El garage no está activo.', 409);
            if (await this.tratoRepo.getByEmpresaGarageWithClientAsync(solicitud.id_empresa, solicitud.id_garage, client)) {
                fail('Ya existe un trato entre la empresa y el garage.', 409);
            }
            const comprometidas = await this.tratoRepo.sumCantidadByGarageWithClientAsync(solicitud.id_garage, client);
            if (Number(solicitud.cantidad_cocheras) > Number(garage.capacidad) - comprometidas) {
                fail('La cantidad solicitada supera las cocheras disponibles.', 409);
            }
            const trato = await this.tratoRepo.createWithClientAsync({
                id_empresa: solicitud.id_empresa,
                id_sede: null,
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
            if (updated.rowCount !== 1) fail('La solicitud ya no está pendiente.', 409);
            await client.query('COMMIT');
            return { solicitud: updated.rows[0], trato };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    };

    rejectAsync = async (id, idUsuario) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no está pendiente.', 409);
            const owns = (await client.query(
                'SELECT 1 FROM usuario_garage WHERE id_usuario=$1 AND id_garage=$2 LIMIT 1', [idUsuario, solicitud.id_garage]
            )).rowCount > 0;
            if (!owns) fail('No tiene permisos sobre el garage de la solicitud.', 403);
            const updated = await client.query(
                'UPDATE solicitudes SET estado=$1 WHERE id=$2 AND estado=$3 RETURNING *',
                [ESTADOS_SOLICITUD.RECHAZADA, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no está pendiente.', 409);
            await client.query('COMMIT');
            return updated.rows[0];
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };

    cancelAsync = async (id, idEmpresa) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (Number(solicitud.id_empresa) !== Number(idEmpresa)) fail('No tiene acceso a esta solicitud.', 403);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no está pendiente.', 409);
            const updated = await client.query(
                'UPDATE solicitudes SET estado=$1 WHERE id=$2 AND estado=$3 RETURNING *',
                [ESTADOS_SOLICITUD.CANCELADA, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no está pendiente.', 409);
            await client.query('COMMIT');
            return updated.rows[0];
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };
}

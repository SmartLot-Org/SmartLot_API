// solicitudEmpresaGarageService.js
import SolicitudEmpresaGarageRepository from '../repositories/solicitudEmpresaGarageRepository.js';
import TratoEmpresaGarageRepository from '../repositories/tratoEmpresaGarageRepository.js';
import NotificacionService from '../services/NotificacionService.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';
import pool from '../database/db.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };
const PAYMENT_MODALITIES = new Set(['empresa_cubre_cupo', 'empleado_paga_todo']);

export default class SolicitudEmpresaGarageService {
    constructor() {
        this.repo = new SolicitudEmpresaGarageRepository();
        this.notificacionService = new NotificacionService();
    }

    _obtenerActorNombre = async (actorId) => {
        try {
            const result = await pool.query(
                `SELECT nombre, apellido FROM usuarios WHERE id = $1 AND COALESCE("Borrado", false) = false`,
                [actorId]
            );
            if (result.rows[0]) {
                return `${result.rows[0].nombre} ${result.rows[0].apellido}`.trim() || 'Unknown';
            }
            return 'Unknown';
        } catch (err) {
            console.error('Error al obtener nombre de actor:', err);
            return 'Unknown';
        }
    };

    _obtenerUsuariosGarage = async (idGarage) => {
        try {
            const result = await pool.query(
                `SELECT u.id, u.nombre, u.apellido FROM usuarios u
                 INNER JOIN usuario_garage ug ON ug.id_usuario = u.id
                 WHERE ug.id_garage = $1 AND COALESCE(u."Borrado", false) = false`,
                [idGarage]
            );
            return result.rows;
        } catch (err) {
            console.error('Error al obtener usuarios del garage:', err);
            return [];
        }
    };

    _obtenerNombreGarage = async (idGarage) => {
        try {
            const result = await pool.query(
                'SELECT nombre FROM garages WHERE id = $1 AND COALESCE("Borrado", false) = false',
                [idGarage]
            );
            return result.rows[0]?.nombre ?? `garage ${idGarage}`;
        } catch (err) {
            console.error('Error al obtener nombre del garage:', err);
            return `garage ${idGarage}`;
        }
    };

    _obtenerAdminsEmpresa = async (idSede, idEmpresa) => {
        try {
            const result = await pool.query(
                `SELECT u.id, u.nombre, u.apellido FROM usuarios u
                 INNER JOIN roles r ON r.id = u.id_rol
                 WHERE u.id_sede = $1 AND u.id_empresa = $2 AND r.tipo_rol = 'admin' AND COALESCE(u."Borrado", false) = false AND COALESCE(r."Borrado", false) = false`,
                [idSede, idEmpresa]
            );
            return result.rows;
        } catch (err) {
            console.error('Error al obtener admins de empresa:', err);
            return [];
        }
    };

    createAsync = async (input, usuario) => {
        if (!hasRole(usuario, 1, ROLE_NAMES.ADMIN)) fail('Solo un administrador puede crear solicitudes.', 403);
        const idEmpresa = Number(usuario?.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) fail('El administrador no tiene una empresa válida.', 403);
        const idSede = Number(input.id_sede);
        const idGarage = Number(input.id_garage);
        const cantidad = Number(input.cantidad_cocheras);
        const modalidadPago = input.modalidad_pago;
        if (!Number.isInteger(idSede) || idSede <= 0) fail('id_sede debe ser un entero positivo.', 400);
        if (!Number.isInteger(idGarage) || idGarage <= 0) fail('id_garage debe ser un entero positivo.', 400);
        if (!Number.isInteger(cantidad) || cantidad <= 0) fail('cantidad_cocheras debe ser un entero mayor que cero.', 400);
        if (!PAYMENT_MODALITIES.has(modalidadPago)) fail('modalidad_pago no es valida.', 400);
        if (usuario.id_sede && Number(usuario.id_sede) !== idSede) fail('No puede crear solicitudes para otra sede.', 403);
        let descripcion = null;
        if (input.descripcion !== undefined && input.descripcion !== null) {
            if (typeof input.descripcion !== 'string') fail('descripcion debe ser un string.', 400);
            descripcion = input.descripcion.trim();
            if (descripcion.length > 1000) fail('descripcion no puede superar 1000 caracteres.', 400);
            if (!descripcion) descripcion = null;
        }

        const result = await this.repo.createPendingAsync({
            id_sede: idSede,
            id_empresa_autorizada: idEmpresa,
            id_garage: idGarage,
            cantidad_cocheras: cantidad,
            descripcion,
            modalidad_pago: modalidadPago,
        });

        // Notificar a los dueños del garage (best-effort, try/catch)
        try {
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const garageNombre = await this._obtenerNombreGarage(idGarage);
            const usuariosGarage = await this._obtenerUsuariosGarage(idGarage);
            for (const usuarioGarage of usuariosGarage) {
                await this.notificacionService.crearAsync(
                    usuarioGarage.id,
                    `${actorNombre} quiere hacer un trato con ${garageNombre} por ${cantidad} cocheras.`,
                    'solicitud_empresa_garage',
                    actorNombre,
                    idGarage
                );
            }
        } catch (err) {
            console.error('Error al crear notificación de solicitud:', err);
        }

        return result;
    };

    getSentAsync = async (usuario) => {
        if (!hasRole(usuario, 1, ROLE_NAMES.ADMIN)) fail('No tiene permisos para ver solicitudes enviadas.', 403);
        const idEmpresa = Number(usuario.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) fail('El administrador no tiene una empresa válida.', 403);
        return this.repo.getSentByEmpresaAsync(idEmpresa, usuario.id_sede ? Number(usuario.id_sede) : null);
    };

    getReceivedAsync = async (usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('No tiene permisos para ver solicitudes recibidas.', 403);
        return this.repo.getReceivedByOwnerAsync(Number(usuario.id));
    };

    getByIdAsync = async (id, usuario) => {
        const solicitud = await this.repo.getByIdAsync(id);
        if (!solicitud) fail('La solicitud no existe.', 404);
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return solicitud;
        if (hasRole(usuario, 1, ROLE_NAMES.ADMIN) && Number(usuario.id_empresa) === Number(solicitud.id_empresa) &&
            (!usuario.id_sede || Number(usuario.id_sede) === Number(solicitud.id_sede))) return solicitud;
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE) && await this.repo.ownerHasGarageAsync(usuario.id, solicitud.id_garage)) return solicitud;
        fail('No tiene acceso a esta solicitud.', 403);
    };

    acceptAsync = async (id, usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('Solo el dueño del garage puede aceptar solicitudes.', 403);
        const resultado = await this.repo.acceptAsync(id, usuario.id);
        const solicitud = resultado.solicitud;
        // Notificar a los admins de la empresa (best-effort, try/catch)
        try {
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const garageNombre = await this._obtenerNombreGarage(solicitud.id_garage);
            const sede = await pool.query('SELECT id, id_empresa FROM sedes WHERE id = $1', [solicitud.id_sede]);
            const idEmpresa = sede.rows[0] ? sede.rows[0].id_empresa : null;
            const idSede = sede.rows[0] ? sede.rows[0].id : null;

            if (idEmpresa) {
                const admins = await this._obtenerAdminsEmpresa(idSede, idEmpresa);
                for (const admin of admins) {
                    await this.notificacionService.crearAsync(
                        admin.id,
                        `${actorNombre} ha ${solicitud.estado === 'aceptada' ? 'aceptado' : 'rechazado'} la solicitud de trato para ${garageNombre}.`,
                        'solicitud_empresa_garage',
                        actorNombre
                    );
                }
            }
        } catch (err) {
            console.error('Error al crear notificación de acept/rechazo:', err);
        }
        return resultado;
    };

    rejectAsync = async (id, usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('Solo el dueño del garage puede rechazar solicitudes.', 403);
        const solicitud = await this.repo.rejectAsync(id, usuario.id);
        // Notificar a los admins de la empresa (best-effort, try/catch)
        try {
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const garageNombre = await this._obtenerNombreGarage(solicitud.id_garage);
            const sede = await pool.query('SELECT id, id_empresa FROM sedes WHERE id = $1', [solicitud.id_sede]);
            const idEmpresa = sede.rows[0] ? sede.rows[0].id_empresa : null;
            const idSede = sede.rows[0] ? sede.rows[0].id : null;

            if (idEmpresa) {
                const admins = await this._obtenerAdminsEmpresa(idSede, idEmpresa);
                for (const admin of admins) {
                    await this.notificacionService.crearAsync(
                        admin.id,
                        `${actorNombre} ha ${solicitud.estado === 'rechazada' ? 'rechazado' : 'aceptado'} la solicitud de trato para ${garageNombre}.`,
                        'solicitud_empresa_garage',
                        actorNombre
                    );
                }
            }
        } catch (err) {
            console.error('Error al crear notificación de acept/rechazo:', err);
        }
        return solicitud;
    };

    cancelAsync = async (id, usuario) => {
        if (!hasRole(usuario, 1, ROLE_NAMES.ADMIN)) fail('Solo la empresa solicitante puede cancelar solicitudes.', 403);
        const idEmpresa = Number(usuario.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) fail('El administrador no tiene una empresa válida.', 403);
        const result = await this.repo.cancelAsync(id, idEmpresa, usuario.id_sede ? Number(usuario.id_sede) : null);
        // Notificar a los dueños del garage (best-effort, try/catch)
        try {
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const garageNombre = await this._obtenerNombreGarage(result.id_garage);
            const usuariosGarage = await this._obtenerUsuariosGarage(result.id_garage);
            for (const usuarioGarage of usuariosGarage) {
                await this.notificacionService.crearAsync(
                    usuarioGarage.id,
                    `${actorNombre} ha cancelado la solicitud de trato para ${garageNombre}.`,
                    'solicitud_empresa_garage',
                    actorNombre,
                    result.id_garage
                );
            }
        } catch (err) {
            console.error('Error al crear notificación de cancelación:', err);
        }
        return result;
    };
    createModificationAsync = async (input, usuario) => {
        if (!hasRole(usuario, 1, ROLE_NAMES.ADMIN)) fail('Solo un administrador puede solicitar modificaciones.', 403);
        const idEmpresa = Number(usuario?.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) fail('El administrador no tiene una empresa válida.', 403);
        const idTrato = Number(input.id_trato);
        const nuevaCantidad = Number(input.cantidad_cocheras);
        if (!Number.isInteger(idTrato) || idTrato <= 0) fail('id_trato debe ser un entero positivo.', 400);
        if (!Number.isInteger(nuevaCantidad) || nuevaCantidad <= 0) fail('cantidad_cocheras debe ser un entero mayor que cero.', 400);

        // Verificar que el trato existe y el admin tiene acceso
        const tratoRepo = new TratoEmpresaGarageRepository();
        const trato = await tratoRepo.getByIdAsync(idTrato);
        if (!trato) fail('El trato no existe.', 404);
        if (Number(trato.id_empresa) !== Number(idEmpresa)) fail('No tiene acceso a este trato.', 403);
        if (usuario.id_sede && Number(usuario.id_sede) !== Number(trato.id_sede)) fail('No puede modificar tratos de otra sede.', 403);

        // Verificar que no haya ya una solicitud de modificación pendiente para este trato
        const existingPending = await this.repo.pool.query(
            `SELECT id FROM solicitudes WHERE id_trato=$1 AND tipo_solicitud='modificacion' AND estado='pendiente' LIMIT 1`,
            [idTrato]
        );
        if (existingPending.rows[0]) fail('Ya existe una solicitud de modificación pendiente para este trato.', 409);

        const result = await this.repo.createPendingAsync({
            id_sede: Number(trato.id_sede),
            id_empresa_autorizada: idEmpresa,
            id_garage: Number(trato.id_garage),
            cantidad_cocheras: nuevaCantidad,
            descripcion: input.descripcion || null,
            modalidad_pago: trato.modalidad_pago,
            tipo_solicitud: 'modificacion',
            id_trato: idTrato,
        });

        // Notificar a los dueños del garage (best-effort)
        try {
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const garageNombre = await this._obtenerNombreGarage(Number(trato.id_garage));
            const usuariosGarage = await this._obtenerUsuariosGarage(Number(trato.id_garage));
            const mensaje = `${actorNombre} solicita cambiar la cantidad de cocheras del trato con ${garageNombre} de ${trato.cantidad_cocheras} a ${nuevaCantidad} cocheras.`;
            for (const usuarioGarage of usuariosGarage) {
                await this.notificacionService.crearAsync(
                    usuarioGarage.id,
                    mensaje,
                    'solicitud_modificacion',
                    actorNombre,
                    Number(trato.id_garage),
                    result.id
                );
            }
        } catch (err) {
            console.error('Error al crear notificación de modificación:', err);
        }

        return result;
    };

    acceptModificationAsync = async (id, usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('Solo el dueño del garage puede autorizar modificaciones.', 403);
        const resultado = await this.repo.acceptModificationAsync(id, usuario.id);
        const solicitud = resultado.solicitud;
        // Notificar a los admins de la empresa (best-effort)
        try {
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const garageNombre = await this._obtenerNombreGarage(solicitud.id_garage);
            const sede = await pool.query('SELECT id, id_empresa FROM sedes WHERE id = $1', [solicitud.id_sede]);
            const idEmpresa = sede.rows[0] ? sede.rows[0].id_empresa : null;
            const idSede = sede.rows[0] ? sede.rows[0].id : null;
            if (idEmpresa) {
                const admins = await this._obtenerAdminsEmpresa(idSede, idEmpresa);
                for (const admin of admins) {
                    await this.notificacionService.crearAsync(
                        admin.id,
                        `${actorNombre} autorizó el cambio de cocheras del trato con ${garageNombre} a ${solicitud.cantidad_cocheras} cocheras.`,
                        'modificacion_autorizada',
                        actorNombre,
                        solicitud.id_garage,
                        solicitud.id
                    );
                }
            }
        } catch (err) {
            console.error('Error al crear notificación de modificación autorizada:', err);
        }
        return resultado;
    };

    rejectModificationAsync = async (id, usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('Solo el dueño del garage puede rechazar modificaciones.', 403);
        const solicitud = await this.repo.rejectModificationAsync(id, usuario.id);
        // Notificar a los admins de la empresa (best-effort)
        try {
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const garageNombre = await this._obtenerNombreGarage(solicitud.id_garage);
            const sede = await pool.query('SELECT id, id_empresa FROM sedes WHERE id = $1', [solicitud.id_sede]);
            const idEmpresa = sede.rows[0] ? sede.rows[0].id_empresa : null;
            const idSede = sede.rows[0] ? sede.rows[0].id : null;
            if (idEmpresa) {
                const admins = await this._obtenerAdminsEmpresa(idSede, idEmpresa);
                for (const admin of admins) {
                    await this.notificacionService.crearAsync(
                        admin.id,
                        `${actorNombre} rechazó el cambio de cocheras solicitado para ${garageNombre}.`,
                        'modificacion_rechazada',
                        actorNombre,
                        solicitud.id_garage,
                        solicitud.id
                    );
                }
            }
        } catch (err) {
            console.error('Error al crear notificación de modificación rechazada:', err);
        }
        return solicitud;
    };
}

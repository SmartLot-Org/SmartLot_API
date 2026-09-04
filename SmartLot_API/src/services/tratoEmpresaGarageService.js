// tratoEmpresaGarageService.js
import TratoEmpresaGarageRepository from '../repositories/tratoEmpresaGarageRepository.js';
import GarageService from './garageService.js';
import SedeService from './sedeService.js';
import UsuarioGarageService from './usuarioGarageService.js';
import SolicitudEmpresaGarageService from './solicitudEmpresaGarageService.js';
import NotificacionService from '../services/NotificacionService.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';
import pool from '../database/db.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

const ROL_LABEL = { admin: 'admin', superadmin: 'superadmin' };
const PAYMENT_MODALITIES = new Set(['empresa_cubre_cupo', 'empleado_paga_todo']);

export default class TratoEmpresaGarageService {
    constructor() {
        this.repo = new TratoEmpresaGarageRepository();
        this.garageService = new GarageService();
        this.sedeService = new SedeService();
        this.usuarioGarageService = new UsuarioGarageService();
        this.notificacionService = new NotificacionService();
        this.solicitudService = new SolicitudEmpresaGarageService();
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

    getAllAsync = async (usuario) => {
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return this.repo.getAllAsync();
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) {
            return this.repo.getByOwnerAsync(usuario.id);
        }
        return this.repo.getByEmpresaAsync(Number(usuario.id_empresa), usuario.id_sede ? Number(usuario.id_sede) : null);
    };

    getByIdAsync = async (id, usuario) => {
        const row = await this.repo.getByIdAsync(id);
        if (!row) fail('El trato no existe.', 404);
        if (!await this._canAccessAsync(usuario, row)) fail('No tiene acceso a este trato.', 403);
        return row;
    };
    getByEmpresaAsync = async (idEmpresa, usuario) => {
        if (!hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN) && Number(usuario.id_empresa) !== Number(idEmpresa)) fail('No tiene acceso a esta empresa.', 403);
        return this.repo.getByEmpresaAsync(idEmpresa, usuario.id_sede || null);
    };
    getByGarageAsync = async (idGarage, usuario) => {
        const rows = await this.repo.getByGarageAsync(idGarage);
        const result = [];
        for (const row of rows) if (await this._canAccessAsync(usuario, row)) result.push(row);
        return result;
    };

    createAsync = async (input, usuario) => {
        if (!hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) fail('Los tratos se crean aceptando una solicitud.', 403);
        const idSede = Number(input.id_sede);
        const idGarage = Number(input.id_garage);
        const cantidad = Number(input.cantidad_cocheras);
        const modalidadPago = input.modalidad_pago || 'empresa_cubre_cupo';
        if (![idSede, idGarage, cantidad].every(Number.isInteger) || Math.min(idSede,idGarage,cantidad) <= 0) fail('Sede, garage y cantidad deben ser enteros positivos.', 400);
        if (usuario.id_sede && Number(usuario.id_sede) !== idSede) fail('No puede operar con otra sede.', 403);
        const sede = await this.sedeService.getByIdAsync(idSede);
        if (!sede) fail('La sede no existe o esta inactiva.', 404);
        if (await this.repo.getBySedeGarageAsync(idSede, idGarage)) fail('Ya existe un trato para esa sede y garage.', 409);
        if (!PAYMENT_MODALITIES.has(modalidadPago)) fail('modalidad_pago no es valida.', 400);
        return this.repo.createAgreementAsync({ id_sede: idSede, id_garage: idGarage, cantidad_cocheras: cantidad, modalidad_pago: modalidadPago });
    };

    updateAsync = async (id, changes, usuario) => {
        const current = await this.getByIdAsync(id, usuario);
        if (!this._adminCanManage(usuario, current)) fail('No puede modificar este trato.', 403);
        const cantidad = Number(changes.cantidad_cocheras);
        if (!Number.isInteger(cantidad) || cantidad <= 0) fail('cantidad_cocheras debe un entero mayor que 0.', 400);

        // Superadmin: actualiza directamente (comportamiento original)
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) {
            const updated = await this.repo.updateQuantityAsync(id, cantidad);
            try {
                const rol = ROL_LABEL[usuario?.tipo_rol] ?? 'admin';
                const actorNombre = await this._obtenerActorNombre(usuario.id);
                const usuariosGarage = await this._obtenerUsuariosGarage(current.id_garage);
                const mensaje = `El ${rol} ${actorNombre} modificó su trato con el garage ${current.garage_nombre} (ahora ${cantidad} cocheras).`;
                for (const usuarioGarage of usuariosGarage) {
                    await this.notificacionService.crearAsync(
                        usuarioGarage.id, mensaje, 'trato_modificado', actorNombre, current.id_garage
                    );
                }
            } catch (err) { console.error('Error al crear notificación de actualización de trato:', err); }
            return updated;
        }

        // Admin: crea solicitud de modificación (espera autorización del dueño)
        const solicitud = await this.solicitudService.createModificationAsync({
            id_trato: id,
            cantidad_cocheras: cantidad,
            descripcion: changes.descripcion || null,
        }, usuario);
        return { ...solicitud, tipo: 'solicitud_modificacion' };
    };
    updatePaymentModalityAsync = async (id, modalidad, usuario) => {
        if (!PAYMENT_MODALITIES.has(modalidad)) fail('modalidadPago no es valida.', 400);
        const current = await this.getByIdAsync(id, usuario);
        if (!this._adminCanManage(usuario, current)) fail('No puede modificar la modalidad de este trato.', 403);
        return this.repo.updatePaymentModalityAsync(id, modalidad, usuario.id);
    };
    deleteAsync = async (id, usuario) => {
        const current = await this.getByIdAsync(id, usuario);
        if (!this._adminCanManage(usuario, current)) fail('No puede eliminar este trato.', 403);
        // Notificar a los dueños del garage (best-effort, try/catch)
        try {
            const rol = ROL_LABEL[usuario?.tipo_rol] ?? 'admin';
            const actorNombre = await this._obtenerActorNombre(usuario.id);
            const usuariosGarage = await this._obtenerUsuariosGarage(current.id_garage);
            const mensaje = `El ${rol} ${actorNombre} canceló su trato con el garage ${current.garage_nombre}.`;
            for (const usuarioGarage of usuariosGarage) {
                await this.notificacionService.crearAsync(
                    usuarioGarage.id,
                    mensaje,
                    'trato_cancelado',
                    actorNombre,
                    current.id_garage
                );
            }
        } catch (err) {
            console.error('Error al crear notificación de eliminación de trato:', err);
        }
        return this.repo.deleteAsync(id);
    };
    _adminCanManage = (usuario, row) => hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN) ||
        (hasRole(usuario, 1, ROLE_NAMES.ADMIN) && Number(usuario.id_empresa) === Number(row.id_empresa) &&
         (!usuario.id_sede || Number(usuario.id_sede) === Number(row.id_sede)));
    _canAccessAsync = async (usuario, row) => {
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return true;
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) return this.usuarioGarageService.userHasGarageAsync(usuario.id, row.id_garage);
        return Number(usuario.id_empresa) === Number(row.id_empresa) && (!usuario.id_sede || Number(usuario.id_sede) === Number(row.id_sede));
    };
}

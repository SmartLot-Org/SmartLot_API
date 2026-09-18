// notificacionService.js
import NotificacionRepository from '../repos/NotificacionRepository.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';

export default class NotificacionService {
    constructor() {
        this.repo = new NotificacionRepository();
    }

    listByUsuarioAsync = async (usuario, leida = null) => {
        if (hasRole(usuario, 3, ROLE_NAMES.GARAGISTA)) return [];
        return await this.repo.listByUsuarioAsync(Number(usuario?.id), leida);
    }

    countNoLeidasAsync = async (usuario) => {
        if (hasRole(usuario, 3, ROLE_NAMES.GARAGISTA)) return 0;
        return await this.repo.countNoLeidasByUsuarioAsync(Number(usuario?.id));
    }

    marcarComoLeidaAsync = async (id, id_usuario) => {
        const notificacion = await this.repo.marcarComoLeidaAsync(id, id_usuario);
        if (!notificacion) throw new Error('Notificación no encontrada o no pertenece al usuario.');
        return notificacion;
    }

    marcarTodasComoLeidasAsync = async (id_usuario) => {
        return await this.repo.marcarTodasComoLeidasAsync(id_usuario);
    }

    eliminarAsync = async (id, id_usuario) => {
        const ok = await this.repo.eliminarAsync(id, id_usuario);
        if (!ok) throw new Error('Notificación no encontrada o no pertenece al usuario.');
        return ok;
    }

    crearAsync = async (id_usuario, mensaje, tipo, actor_nombre, id_garage = null, id_relacion = null, leida = false) => {
        if (await this.repo.esGaragistaAsync(id_usuario)) {
            console.warn(`[notificaciones] Se omitió una notificación para el usuario garagista ${id_usuario}.`);
            return null;
        }
        return await this.repo.insertarAsync({
            id_usuario, mensaje, tipo, actor_nombre, id_garage, id_relacion, leida
        });
    }
}
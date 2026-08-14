// notificacionService.js
import NotificacionRepository from '../repos/NotificacionRepository.js';

export default class NotificacionService {
    constructor() {
        this.repo = new NotificacionRepository();
    }

    listByUsuarioAsync = async (id_usuario, leida = null) => {
        return await this.repo.listByUsuarioAsync(id_usuario, leida);
    }

    countNoLeidasAsync = async (id_usuario) => {
        return await this.repo.countNoLeidasByUsuarioAsync(id_usuario);
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
        return await this.repo.insertarAsync({
            id_usuario, mensaje, tipo, actor_nombre, id_garage, id_relacion, leida
        });
    }
}
// notificacionController.js
import { Router } from 'express';
import NotificacionService from '../services/NotificacionService.js';
import { idParam } from '../helpers/validatorHelper.js';

const router = Router();
const svc = new NotificacionService();

router.param('id', idParam());

router.get('', async (req, res) => {
    const leida = req.query.leida;
    const data = await svc.listByUsuarioAsync(req.usuario, leida === 'true');
    res.status(200).json(data.slice(0, 50));
});

router.get('/no-leidas/count', async (req, res) => {
    const count = await svc.countNoLeidasAsync(req.usuario);
    res.status(200).json({ no_leidas: count });
});

router.patch('/:id/leer', async (req, res) => {
    const id = req.params.id;
    const id_usuario = req.usuario.id;
    const notificacion = await svc.marcarComoLeidaAsync(id, id_usuario);
    res.status(200).json(notificacion);
});

router.patch('/leer-todas', async (req, res) => {
    const id_usuario = req.usuario.id;
    await svc.marcarTodasComoLeidasAsync(id_usuario);
    res.status(200).json({ message: 'Todas las notificaciones marcadas como leídas.' });
});

router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    const id_usuario = req.usuario.id;
    await svc.eliminarAsync(id, id_usuario);
    res.status(200).json({ message: 'Notificación eliminada.' });
});

export default router;
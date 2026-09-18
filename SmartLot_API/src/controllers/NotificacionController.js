// notificacionController.js
import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import NotificacionService from '../services/NotificacionService.js';

const router = Router();
const svc = new NotificacionService();

router.get('', authMiddleware, async (req, res) => {
    const leida = req.query.leida;
    const data = await svc.listByUsuarioAsync(req.usuario, leida === 'true');
    const max = data ? data.slice(0, 50) : [];
    res.status(200).json(max);
});

router.get('/no-leidas/count', authMiddleware, async (req, res) => {
    const count = await svc.countNoLeidasAsync(req.usuario);
    res.status(200).json({ no_leidas: count });
});

router.patch('/:id/leer', authMiddleware, async (req, res) => {
    const id = req.params.id;
    const id_usuario = req.usuario.id;
    const notificacion = await svc.marcarComoLeidaAsync(Number(id), id_usuario);
    res.status(200).json(notificacion);
});

router.patch('/leer-todas', authMiddleware, async (req, res) => {
    const id_usuario = req.usuario.id;
    await svc.marcarTodasComoLeidasAsync(id_usuario);
    res.status(200).json({ message: 'Todas las notificaciones marcadas como leídas.' });
});

router.delete('/:id', authMiddleware, async (req, res) => {
    const id = req.params.id;
    const id_usuario = req.usuario.id;
    await svc.eliminarAsync(Number(id), id_usuario);
    res.status(200).json({ message: 'Notificación eliminada.' });
});

export default router;
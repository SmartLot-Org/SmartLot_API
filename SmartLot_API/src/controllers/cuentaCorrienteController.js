import { Router } from 'express';
import CuentaCorrienteService from '../services/cuentaCorrienteService.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { ROLE_NAMES } from '../helpers/roles.js';

const router = Router();
const service = new CuentaCorrienteService();

router.get('/admin', requireRole(1), async (req, res) => {
    const result = await service.getAdminAsync(req.query, req.usuario);
    res.status(200).json(result);
});

router.get('/dueno', requireRole(5, ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    const result = await service.getDuenoAsync(req.query, req.usuario);
    res.status(200).json(result);
});

export default router;

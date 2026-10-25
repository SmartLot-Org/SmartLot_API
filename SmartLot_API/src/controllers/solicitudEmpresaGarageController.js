import { Router } from 'express';
import SolicitudEmpresaGarageService from '../services/solicitudEmpresaGarageService.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { ROLE_NAMES } from '../helpers/roles.js';
import { idParam } from '../helpers/validatorHelper.js';

const router = Router();
const svc = new SolicitudEmpresaGarageService();

router.param('id', idParam());

router.post('', requireRole(1, ROLE_NAMES.ADMIN), async (req, res) => {
    const { id_sede, id_garage, cantidad_cocheras, descripcion, modalidad_pago, modalidadPago } = req.body;
    res.status(201).json(await svc.createAsync({ id_sede, id_garage, cantidad_cocheras, descripcion, modalidad_pago: modalidad_pago ?? modalidadPago }, req.usuario));
});

router.get('/enviadas', requireRole(1, ROLE_NAMES.ADMIN), async (req, res) => {
    res.status(200).json(await svc.getSentAsync(req.usuario));
});

router.get('/recibidas', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.getReceivedAsync(req.usuario));
});

router.patch('/:id/aceptar', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.acceptAsync(req.params.id, req.usuario));
});

router.patch('/:id/rechazar', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.rejectAsync(req.params.id, req.usuario));
});

router.patch('/:id/autorizar-modificacion', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.acceptModificationAsync(req.params.id, req.usuario));
});

router.patch('/:id/rechazar-modificacion', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.rejectModificationAsync(req.params.id, req.usuario));
});

router.patch('/:id/cancelar', requireRole(1, ROLE_NAMES.ADMIN), async (req, res) => {
    res.status(200).json(await svc.cancelAsync(req.params.id, req.usuario));
});

router.get('/:id', requireRole(1, 4, ROLE_NAMES.ADMIN, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    res.status(200).json(await svc.getByIdAsync(req.params.id, req.usuario));
});

export default router;

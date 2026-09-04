import { Router } from 'express';
import SolicitudEmpresaGarageService from '../services/solicitudEmpresaGarageService.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { ROLE_NAMES } from '../helpers/roles.js';
import { isValidId } from '../helpers/validatorHelper.js';

const router = Router();
const svc = new SolicitudEmpresaGarageService();
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const parseId = (value) => {
    if (!isValidId(value)) fail('El ID debe ser un entero positivo.');
    return Number(value);
};

router.post('', requireRole(1, ROLE_NAMES.ADMIN), async (req, res) => {
    const { id_sede, id_garage, cantidad_cocheras, descripcion } = req.body;
    res.status(201).json(await svc.createAsync({ id_sede, id_garage, cantidad_cocheras, descripcion }, req.usuario));
});

router.get('/enviadas', requireRole(1, ROLE_NAMES.ADMIN), async (req, res) => {
    res.status(200).json(await svc.getSentAsync(req.usuario));
});

router.get('/recibidas', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.getReceivedAsync(req.usuario));
});

router.patch('/:id/aceptar', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.acceptAsync(parseId(req.params.id), req.usuario));
});

router.patch('/:id/rechazar', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.rejectAsync(parseId(req.params.id), req.usuario));
});

router.patch('/:id/autorizar-modificacion', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.acceptModificationAsync(parseId(req.params.id), req.usuario));
});

router.patch('/:id/rechazar-modificacion', requireRole(ROLE_NAMES.DUENO_GARAGE), async (req, res) => {
    res.status(200).json(await svc.rejectModificationAsync(parseId(req.params.id), req.usuario));
});

router.patch('/:id/cancelar', requireRole(1, ROLE_NAMES.ADMIN), async (req, res) => {
    res.status(200).json(await svc.cancelAsync(parseId(req.params.id), req.usuario));
});

router.get('/:id', requireRole(1, 4, ROLE_NAMES.ADMIN, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    res.status(200).json(await svc.getByIdAsync(parseId(req.params.id), req.usuario));
});

export default router;

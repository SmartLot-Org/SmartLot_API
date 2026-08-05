import { Router } from 'express';
import TratoEmpresaGarageService from '../services/tratoEmpresaGarageService.js';
import { isValidId } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { ROLE_NAMES } from '../helpers/roles.js';

const router = Router();
const svc = new TratoEmpresaGarageService();
const readRoles = [1, 2, 4, ROLE_NAMES.ADMIN, ROLE_NAMES.CLIENTE, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN];
const writeRoles = [1, 4, ROLE_NAMES.ADMIN, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN];

const fail = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
};

const parseId = (value, field = 'ID') => {
    if (!isValidId(value)) fail(`${field} debe ser un entero valido.`);
    return Number(value);
};

const body = (source, partial = false) => {
    const fields = ['id_empresa', 'id_garage', 'cantidad_cocheras', 'precio_pickup', 'precio_auto'];
    const result = {};
    for (const field of fields) {
        if (!partial || source[field] !== undefined) result[field] = source[field];
    }
    return result;
};

router.get('', requireRole(...readRoles), async (req, res) => {
    res.status(200).json(await svc.getAllAsync(req.usuario));
});

router.get('/empresa/:id_empresa', requireRole(...readRoles), async (req, res) => {
    res.status(200).json(await svc.getByEmpresaAsync(parseId(req.params.id_empresa, 'id_empresa'), req.usuario));
});

router.get('/garage/:id_garage', requireRole(...readRoles), async (req, res) => {
    res.status(200).json(await svc.getByGarageAsync(parseId(req.params.id_garage, 'id_garage'), req.usuario));
});

router.get('/:id', requireRole(...readRoles), async (req, res) => {
    res.status(200).json(await svc.getByIdAsync(parseId(req.params.id), req.usuario));
});

router.post('', requireRole(...writeRoles), async (req, res) => {
    res.status(201).json(await svc.createAsync(body(req.body), req.usuario));
});

router.put('/:id', requireRole(...writeRoles), async (req, res) => {
    res.status(200).json(await svc.updateAsync(parseId(req.params.id), body(req.body, true), req.usuario));
});

router.delete('/:id', requireRole(...writeRoles), async (req, res) => {
    await svc.deleteAsync(parseId(req.params.id), req.usuario);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

export default router;

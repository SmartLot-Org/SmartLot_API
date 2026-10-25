import { Router } from 'express';
import TratoEmpresaGarageService from '../services/tratoEmpresaGarageService.js';
import { idParam } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { ROLE_NAMES } from '../helpers/roles.js';
import { throwError } from '../helpers/httpError.js';

const router = Router();
const svc = new TratoEmpresaGarageService();
const readRoles = [1, 2, 4, ROLE_NAMES.ADMIN, ROLE_NAMES.CLIENTE, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN];
const writeRoles = [1, 4, ROLE_NAMES.ADMIN, ROLE_NAMES.SUPERADMIN];

router.param('id', idParam());
router.param('id_empresa', idParam('ID de empresa'));
router.param('id_garage', idParam('ID de garage'));

const body = (source, partial = false) => {
    const fields = ['id_sede', 'id_garage', 'cantidad_cocheras'];
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
    res.status(200).json(await svc.getByEmpresaAsync(req.params.id_empresa, req.usuario));
});

router.get('/garage/:id_garage', requireRole(...readRoles), async (req, res) => {
    res.status(200).json(await svc.getByGarageAsync(req.params.id_garage, req.usuario));
});

router.get('/:id', requireRole(...readRoles), async (req, res) => {
    res.status(200).json(await svc.getByIdAsync(req.params.id, req.usuario));
});

router.patch('/:id/modalidad-pago', requireRole(...writeRoles), async (req, res) => {
    res.status(200).json(await svc.updatePaymentModalityAsync(
        req.params.id, req.body?.modalidadPago, req.usuario
    ));
});

// Alta directa de un trato: solo el superadmin. Un administrador de empresa propone el trato con
// POST /api/solicitud-empresa-garage y el dueño del garage lo acepta; un recurso, una entidad.
router.post('', requireRole(4, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    res.status(201).json(await svc.createAsync(body(req.body), req.usuario));
});

router.put('/:id', requireRole(...writeRoles), async (req, res) => {
    res.status(200).json(await svc.updateAsync(req.params.id, body(req.body, true), req.usuario));
});

router.patch('/:id/cancelar', requireRole(...writeRoles), async (req, res) => {
    const ok = await svc.cancelAsync(req.params.id, req.usuario);
    if (!ok) throwError('El trato no existe o ya está cancelado.', 404);
    res.status(200).json({ message: 'Trato cancelado exitosamente.' });
});

export default router;

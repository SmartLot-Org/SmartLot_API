// conflictoController.js
import { Router } from 'express';
import ConflictoService from './../services/ConflictoService.js';
import { idParam, isValidId, isValidString } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { throwError } from '../helpers/httpError.js';

const router = Router();
const svc = new ConflictoService();

router.param('id', idParam());

const PRIORIDADES_VALIDAS = ['Baja', 'Media', 'Alta'];
const ESTADOS_VALIDOS = ['Pendiente', 'En Proceso', 'Resuelto'];

const parseBooleanQuery = (value) => value === true || value === 'true' || value === '1';
const getRequestUserId = (req) => req.usuario?.id ?? req.usuario?.id_usuario ?? req.usuario?.usuario_id;
const isRequestSuperadmin = (req) => Number(req.usuario?.id_rol) === 4;

const validateSuperadminScope = (req, superAdmin) => {
    if (superAdmin && !isRequestSuperadmin(req)) {
        throwError('No autorizado para consultar conflictos de superadmin.', 403);
    }
};

// GET ALL
router.get('', requireRole(1, 4), async (req, res) => {
    const superAdmin = parseBooleanQuery(req.query.superAdmin);
    validateSuperadminScope(req, superAdmin);
    const data = await svc.getAllAsync(superAdmin, req.usuario);
    res.status(200).json(data);
});

// GET DELETED BY CURRENT ADMIN
router.get('/papelera', requireRole(1, 4), async (req, res) => {
    const superAdmin = parseBooleanQuery(req.query.superAdmin);
    validateSuperadminScope(req, superAdmin);
    const data = await svc.getDeletedByUserAsync(getRequestUserId(req), superAdmin, req.usuario);
    res.status(200).json(data);
});

// GET BY ID
router.get('/:id', requireRole(1, 4), async (req, res) => {
    const { id } = req.params;

    const data = await svc.getByIdAsync(id, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// CREATE (POST)
router.post('', requireRole(1, 2, 4), async (req, res) => {
    if (Number(req.usuario?.id_rol) === 2) {
        req.body.id_usuario = getRequestUserId(req);
        req.body.SuperAdmin = false;
    }

    if (Number(req.usuario?.id_rol) === 1) {
        req.body.id_usuario = getRequestUserId(req);
        req.body.SuperAdmin = true;
    }

    if (Number(req.usuario?.id_rol) === 4 && !req.body.id_usuario) {
        req.body.id_usuario = getRequestUserId(req);
    }

    const { id_usuario, descripcion, prioridad, SuperAdmin } = req.body;

    if (!isValidId(String(id_usuario))) throwError('El id_usuario es requerido y debe ser un numero valido.', 400);
    if (!isValidString(descripcion)) throwError('La descripcion es requerida.', 400);
    if (!prioridad || !PRIORIDADES_VALIDAS.includes(prioridad)) {
        throwError(`La prioridad debe ser una de: ${PRIORIDADES_VALIDAS.join(', ')}.`, 400);
    }
    if (SuperAdmin !== undefined && typeof SuperAdmin !== 'boolean') {
        throwError('SuperAdmin debe ser un valor booleano.', 400);
    }

    const data = await svc.createAsync(req.body, req.usuario);
    res.status(201).json(data);
});

// UPDATE (PUT)
router.put('/:id', requireRole(1, 4), async (req, res) => {

    const { id_usuario, descripcion, prioridad, estado, SuperAdmin } = req.body;

    if (id_usuario !== undefined && !isValidId(String(id_usuario))) {
        throwError('El id_usuario debe ser un numero valido.', 400);
    }
    if (descripcion !== undefined && !isValidString(descripcion)) {
        throwError('La descripcion no puede estar vacia.', 400);
    }
    if (prioridad !== undefined && !PRIORIDADES_VALIDAS.includes(prioridad)) {
        throwError(`La prioridad debe ser una de: ${PRIORIDADES_VALIDAS.join(', ')}.`, 400);
    }
    if (estado !== undefined && !ESTADOS_VALIDOS.includes(estado)) {
        throwError(`El estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}.`, 400);
    }
    if (SuperAdmin !== undefined && typeof SuperAdmin !== 'boolean') {
        throwError('SuperAdmin debe ser un valor booleano.', 400);
    }

    const data = await svc.updateAsync(req.params.id, req.body, req.usuario);
    if (!data) throwError('No encontrado: El conflicto con ese ID no existe.', 404);
    res.status(200).json(data);
});

// DELETE
router.delete('/:id', requireRole(1, 4), async (req, res) => {
    const { id } = req.params;

    const ok = await svc.deleteAsync(id, getRequestUserId(req), req.usuario);
    if (!ok) throwError('No encontrado: El conflicto con ese ID no existe.', 404);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

// RESTORE
router.patch('/:id/restaurar', requireRole(1, 4), async (req, res) => {
    const { id } = req.params;

    const data = await svc.restoreAsync(id, getRequestUserId(req), req.usuario);
    if (!data) throwError('No encontrado: El conflicto no existe en tu papelera.', 404);
    res.status(200).json(data);
});

export default router;

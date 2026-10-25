import { Router } from 'express';
import RolService from './../services/rolService.js';
import { idParam, isValidString } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { throwError } from '../helpers/httpError.js';
import { BAD_REQUEST, NOT_FOUND } from '../helpers/httpStatus.js';

const router = Router();
const svc = new RolService();

router.param('id', idParam());

// GET ALL
router.get('', async (req, res) => {
    const data = await svc.getAllAsync();
    res.status(200).json(data);
});

// GET BY ID
router.get('/:id', async (req, res) => {
    const data = await svc.getByIdAsync(req.params.id);
    if (!data) throwError('No encontrado.', NOT_FOUND);
    res.status(200).json(data);
});

// CREATE (POST)
router.post('', requireRole(4), async (req, res) => {
    const { tipo_rol } = req.body;
    if (!isValidString(tipo_rol)) throwError('El tipo_rol es requerido.', BAD_REQUEST);

    const data = await svc.createAsync(req.body);
    res.status(201).json(data);
});

// UPDATE (PUT): reemplazo completo, por eso exige todos los campos obligatorios.
router.put('/:id', requireRole(4), async (req, res) => {
    const { tipo_rol } = req.body;
    if (!isValidString(tipo_rol)) throwError('El tipo_rol es requerido.', BAD_REQUEST);

    const data = await svc.updateAsync(req.params.id, req.body);
    if (!data) throwError('No encontrado: El rol con ese ID no existe.', NOT_FOUND);
    res.status(200).json(data);
});

// DELETE
router.delete('/:id', requireRole(4), async (req, res) => {
    const ok = await svc.deleteAsync(req.params.id, req.usuario);
    if (!ok) throwError('No encontrado: El rol con ese ID no existe.', NOT_FOUND);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

export default router;

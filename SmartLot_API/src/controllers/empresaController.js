import { Router } from 'express';
import EmpresaService from './../services/empresaService.js';
import { idParam, isValidString } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { throwError } from '../helpers/httpError.js';
import { BAD_REQUEST, NOT_FOUND } from '../helpers/httpStatus.js';

const router = Router();
const svc = new EmpresaService();

router.param('id', idParam());

// GET ALL
router.get('', requireRole(4), async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    res.status(200).json(data);
});

// GET AUDITORIA
router.get('/auditoria', requireRole(4), async (req, res) => {
    const data = await svc.getAuditAsync();
    res.status(200).json(data);
});

// GET BY ID
router.get('/:id', async (req, res) => {
    const data = await svc.getByIdAsync(req.params.id, req.usuario);
    if (!data) throwError('No encontrado.', NOT_FOUND);
    res.status(200).json(data);
});

// CREATE (POST)
router.post('', requireRole(4), async (req, res) => {
    const { nombre } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', BAD_REQUEST);

    const data = await svc.createAsync(req.body);
    res.status(201).json(data);
});

// UPDATE (PUT): reemplazo completo. La descripción es opcional en la base, pero
// debe viajar de forma explícita (texto o null): omitirla la borraría sin que el cliente lo pida.
router.put('/:id', requireRole(4), async (req, res) => {
    const { nombre, descripcion } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', BAD_REQUEST);
    if (descripcion !== null && typeof descripcion !== 'string') {
        throwError('La descripción es requerida: envíe el texto o null.', BAD_REQUEST);
    }

    const data = await svc.updateAsync(req.params.id, req.body, req.usuario);
    if (!data) throwError('No encontrado: La empresa con ese ID no existe.', NOT_FOUND);
    res.status(200).json(data);
});

// DELETE
router.delete('/:id', requireRole(4), async (req, res) => {
    const ok = await svc.deleteAsync(req.params.id, req.usuario);
    if (!ok) throwError('No encontrado: La empresa con ese ID no existe.', NOT_FOUND);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

export default router;

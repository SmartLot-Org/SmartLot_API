import { Router } from 'express';
import VehiculoService from './../services/vehiculoService.js';
import { idParam, isValidId, isValidPatente } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { throwError } from '../helpers/httpError.js';

const router = Router();
const svc = new VehiculoService();

router.param('id', idParam());

// GET ALL
router.get('', async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    res.status(200).json(data);
});

// GET BY ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    const data = await svc.getByIdAsync(id, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// CREATE (POST)
router.post('', requireRole(1, 2, 4), async (req, res) => {
    const { id_usuario, id_modelo, patente } = req.body;
    if (!isValidId(String(id_usuario))) throwError('El id_usuario es requerido y debe ser un número válido.', 400);
    if (!isValidId(String(id_modelo))) throwError('El id_modelo es requerido y debe ser un número válido.', 400);
    if (!isValidPatente(patente)) throwError('La patente es requerida y debe tener formato válido (ABC123 o AB123CD).', 400);

    const data = await svc.createAsync(req.body, req.usuario);
    res.status(201).json(data);
});

// UPDATE (PUT)
router.put('/:id', requireRole(1, 2, 4), async (req, res) => {
    const { id_usuario, id_modelo, patente } = req.body;
    if (id_usuario !== undefined && !isValidId(String(id_usuario))) throwError('El id_usuario debe ser un número válido.', 400);
    if (id_modelo !== undefined && !isValidId(String(id_modelo))) throwError('El id_modelo debe ser un número válido.', 400);
    if (patente !== undefined && !isValidPatente(patente)) throwError('La patente debe tener formato válido (ABC123 o AB123CD).', 400);

    const data = await svc.updateAsync(req.params.id, req.body, req.usuario);
    if (!data) throwError('No encontrado: El vehículo con ese ID no existe.', 404);
    res.status(200).json(data);
});

// DELETE
router.delete('/:id', requireRole(1, 4), async (req, res) => {
    const { id } = req.params;

    const ok = await svc.deleteAsync(id, req.usuario);
    if (!ok) throwError('No encontrado: El vehículo con ese ID no existe.', 404);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

export default router;

import { Router } from 'express';
import SedeService from './../services/sedeService.js';
import { isValidId, isValidString } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';

const router = Router();
const svc = new SedeService();

function throwError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

// GET ALL
router.get('', async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    if (!data) throwError('Error interno del servidor', 500);
    res.status(200).json(data);
});

// GET BY ID
router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.getByIdAsync(id, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// CREATE (POST)
router.post('', requireRole(1, 4), async (req, res) => {
    const { nombre, id_empresa, ubicacion, latitud, longitud } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', 400);
    if (!isValidId(String(id_empresa))) throwError('El id_empresa es requerido y debe ser un número válido.', 400);

    const data = await svc.createAsync(req.body);
    if (!data) throwError('Error interno al crear la sede.', 500);
    res.status(201).json(data);
});

// UPDATE (PUT)
router.put('/:id', requireRole(1, 4), async (req, res) => {
    if (!isValidId(req.params.id)) throwError('El ID proporcionado no es válido.', 400);
    const { nombre, id_empresa, ubicacion, latitud, longitud } = req.body;
    if (nombre !== undefined && !isValidString(nombre)) throwError('El nombre no puede estar vacío.', 400);
    if (id_empresa !== undefined && !isValidId(String(id_empresa))) throwError('El id_empresa debe ser un número válido.', 400);

    const data = await svc.updateAsync(parseInt(req.params.id, 10), req.body);
    if (!data) throwError('No encontrado: La sede con ese ID no existe.', 404);
    res.status(200).json(data);
});

// DELETE
router.delete('/:id', requireRole(1, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const ok = await svc.deleteAsync(id, req.usuario);
    if (!ok) throwError('No encontrado: La sede con ese ID no existe.', 404);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

export default router;

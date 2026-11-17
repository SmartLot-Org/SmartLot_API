import { Router } from 'express';
import ModeloService from './../services/modeloService.js';
import { idParam, isValidId, isValidString } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { throwError } from '../helpers/httpError.js';
import { BAD_REQUEST, NOT_FOUND } from '../helpers/httpStatus.js';

const router = Router();
const svc = new ModeloService();

router.param('id', idParam());

// modelos.tipo_vehiculo es NOT NULL (enum) y define la tarifa de los vehículos del modelo:
// sin validarlo acá, el alta llegaba a la base y respondía 400 DB_NOT_NULL_VIOLATION.
// Las validaciones quedan en cada handler: el inventario de docs/plans-franC/api.md lee de ahí los códigos.
const TIPOS_VEHICULO = ['auto', 'moto', 'pickup'];

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
    const { nombre, id_marca, tipo_vehiculo } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', BAD_REQUEST);
    if (!isValidId(id_marca)) throwError('El id_marca es requerido y debe ser un número válido.', BAD_REQUEST);
    if (!TIPOS_VEHICULO.includes(tipo_vehiculo)) throwError(`El tipo_vehiculo es requerido y debe ser uno de: ${TIPOS_VEHICULO.join(', ')}.`, BAD_REQUEST);

    const data = await svc.createAsync(req.body);
    res.status(201).json(data);
});

// UPDATE (PUT): reemplazo completo, por eso exige todos los campos obligatorios.
router.put('/:id', requireRole(4), async (req, res) => {
    const { nombre, id_marca, tipo_vehiculo } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', BAD_REQUEST);
    if (!isValidId(id_marca)) throwError('El id_marca es requerido y debe ser un número válido.', BAD_REQUEST);
    if (!TIPOS_VEHICULO.includes(tipo_vehiculo)) throwError(`El tipo_vehiculo es requerido y debe ser uno de: ${TIPOS_VEHICULO.join(', ')}.`, BAD_REQUEST);

    const data = await svc.updateAsync(req.params.id, req.body);
    if (!data) throwError('No encontrado: El modelo con ese ID no existe.', NOT_FOUND);
    res.status(200).json(data);
});

// DELETE
router.delete('/:id', requireRole(4), async (req, res) => {
    const ok = await svc.deleteAsync(req.params.id, req.usuario);
    if (!ok) throwError('No encontrado: El modelo con ese ID no existe.', NOT_FOUND);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

export default router;

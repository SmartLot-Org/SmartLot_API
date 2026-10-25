import { Router } from 'express';
import SedeService from './../services/sedeService.js';
import { idParam, isValidId, isValidString } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { throwError } from '../helpers/httpError.js';
import { BAD_REQUEST, NOT_FOUND } from '../helpers/httpStatus.js';

const router = Router();
const svc = new SedeService();

const CAMPOS_EDITABLES = ['id_empresa', 'nombre', 'descripcion', 'ubicacion', 'latitud', 'longitud'];

router.param('id', idParam());

// Validación de los campos que llegan en el cuerpo; la comparten PUT y PATCH.
function validarCamposEnviados({ nombre, id_empresa }) {
    if (nombre !== undefined && !isValidString(nombre)) throwError('El nombre no puede estar vacío.', BAD_REQUEST);
    if (id_empresa !== undefined && !isValidId(id_empresa)) throwError('El id_empresa debe ser un número válido.', BAD_REQUEST);
}

// GET ALL
router.get('', async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    res.status(200).json(data);
});

// GET BY ID
router.get('/:id', async (req, res) => {
    const data = await svc.getByIdAsync(req.params.id, req.usuario);
    if (!data) throwError('No encontrado.', NOT_FOUND);
    res.status(200).json(data);
});

// CREATE (POST)
router.post('', requireRole(1, 4), async (req, res) => {
    const { nombre, id_empresa } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', BAD_REQUEST);
    if (id_empresa !== undefined && !isValidId(id_empresa)) throwError('El id_empresa debe ser un número válido.', BAD_REQUEST);

    const data = await svc.createAsync(req.body, req.usuario);
    res.status(201).json(data);
});

// UPDATE (PUT): reemplazo completo, por eso exige los campos obligatorios: el nombre y la
// ubicación (texto o null explícito). Los campos con efecto de tenant o de mapa que no se
// envían (id_empresa, descripcion, coordenadas) se conservan: omitirlos no los borra.
router.put('/:id', requireRole(1, 4), async (req, res) => {
    validarCamposEnviados(req.body);
    if (!isValidString(req.body.nombre)) throwError('El nombre es requerido.', BAD_REQUEST);
    const { ubicacion } = req.body;
    if (ubicacion !== null && typeof ubicacion !== 'string') {
        throwError('La ubicación es requerida: envíe el texto o null.', BAD_REQUEST);
    }

    const data = await svc.updateAsync(req.params.id, req.body, req.usuario);
    if (!data) throwError('No encontrado: La sede con ese ID no existe.', NOT_FOUND);
    res.status(200).json(data);
});

// UPDATE parcial (PATCH): solo cambia los campos presentes en el cuerpo.
router.patch('/:id', requireRole(1, 4), async (req, res) => {
    validarCamposEnviados(req.body);
    if (!CAMPOS_EDITABLES.some(campo => req.body[campo] !== undefined)) {
        throwError(`Envíe al menos un campo para actualizar: ${CAMPOS_EDITABLES.join(', ')}.`, BAD_REQUEST);
    }

    const data = await svc.updateAsync(req.params.id, req.body, req.usuario);
    if (!data) throwError('No encontrado: La sede con ese ID no existe.', NOT_FOUND);
    res.status(200).json(data);
});

// DELETE
router.delete('/:id', requireRole(1, 4), async (req, res) => {
    const ok = await svc.deleteAsync(req.params.id, req.usuario);
    if (!ok) throwError('No encontrado: La sede con ese ID no existe.', NOT_FOUND);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

export default router;

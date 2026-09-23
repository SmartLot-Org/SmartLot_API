import { Router } from 'express';
import ReservaService from './../services/reservaService.js';
import { isValidId, isValidDate, isValidDiaSemana } from '../helpers/validatorHelper.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { requireRole, requireAdmin } from '../middlewares/rolesMiddleware.js';

const router = Router();
const svc = new ReservaService();

function throwError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

/**
 * Convencion de roles (verificar contra la tabla `roles`):
 *   1 = admin
 *   2 = cliente
 *   3 = garagista
 */

// GET ALL
router.get('', async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    if (!data) throwError('Error interno del servidor', 500);
    res.status(200).json(data);
});

// GET DISPONIBILIDAD POR HORA
router.get('/disponibilidad-por-hora', async (req, res) => {
    const garage_id = parseInt(req.query.garage_id);
    const fecha = req.query.fecha;

    if (isNaN(garage_id)) throwError('El garage_id es requerido y debe ser un número válido.', 400);
    if (!fecha) throwError('La fecha es requerida (formato YYYY-MM-DD).', 400);

    const data = await svc.getDisponibilidadPorHoraAsync(garage_id, fecha);
    res.status(200).json(data);
});

router.post('/cotizacion', requireRole(2), async (req, res) => {
    res.status(200).json(await svc.quoteAsync(req.body ?? {}, req.usuario));
});

// GET CONTROL DE ACCESO (admin, smartlot o garagista del garage)
router.get('/control-acceso/:id_garage', requireRole(1, 3, 4), async (req, res) => {
    const idGarage = parseInt(req.params.id_garage, 10);
    const fecha = String(req.query.fecha ?? '');
    if (!isValidId(String(idGarage))) throwError('El ID de garage no es valido.', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !isValidDate(`${fecha}T00:00:00`)) {
        throwError('La fecha es requerida (formato YYYY-MM-DD).', 400);
    }

    const data = await svc.getControlAccesoAsync(idGarage, fecha, req.usuario);
    res.status(200).json(data);
});

// GET BY USER
router.get('/usuario/:id_usuario', async (req, res) => {
    const id_usuario = parseInt(req.params.id_usuario);
    if (isNaN(id_usuario)) throwError('El ID de usuario no es válido.', 400);

    // Verificación de propiedad: solo el propio usuario, un admin o un superadmin
    // pueden consultar las reservas de un usuario (evita enumeración entre tenants).
    const rol = Number(req.usuario.id_rol);
    if (rol !== 1 && rol !== 4 && Number(req.usuario.id) !== id_usuario) {
        throwError('No tiene permisos para ver las reservas de este usuario.', 403);
    }

    const data = await svc.getByUsuarioWithDetailsAsync(id_usuario, req.usuario);
    if (!data) throwError('Error interno del servidor', 500);
    res.status(200).json(data);
});

// GET QR DE RESERVA (solo cliente/empleado titular)
router.get('/:id/qr', requireRole(2), async (req, res) => {
    if (!isValidId(req.params.id)) throwError('El ID proporcionado no es valido.', 400);
    const id = parseInt(req.params.id, 10);

    const data = await svc.getQrAsync(id, req.usuario);
    res.set('Cache-Control', 'no-store');
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
router.post('', authMiddleware, requireRole(2), async (req, res) => {
    const body = req.body ?? {};

    const { id_garage, id_vehiculo, fecha_entrada, fecha_salida, dia } = body;
    if (!isValidId(String(id_garage))) throwError('El id_garage es requerido y debe ser un número válido.', 400);
    if (!isValidId(String(id_vehiculo))) throwError('El id_vehiculo es requerido y debe ser un número válido.', 400);
    if (!isValidDate(fecha_entrada)) throwError('La fecha de entrada es requerida y debe ser una fecha válida.', 400);
    if (!isValidDate(fecha_salida)) throwError('La fecha de salida es requerida y debe ser una fecha válida.', 400);
    if (!dia || !isValidDiaSemana(dia)) throwError('El dia es requerido y debe ser un valor valido: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.', 400);

    const data = await svc.createAsync(body, req.usuario);
    if (!data) throwError('Error interno al crear la reserva.', 500);
    res.status(201).json(data);
});

// UPDATE (PUT)
router.put('/:id', authMiddleware, async (req, res) => {
    if (!isValidId(req.params.id)) throwError('El ID proporcionado no es válido.', 400);
    const body = req.body ?? {};

    const { id_usuario, id_garage, id_vehiculo, fecha_entrada, fecha_salida, dia } = body;
    if (id_usuario !== undefined && !isValidId(String(id_usuario))) throwError('El id_usuario debe ser un número válido.', 400);
    if (id_garage !== undefined && !isValidId(String(id_garage))) throwError('El id_garage debe ser un número válido.', 400);
    if (id_vehiculo !== undefined && !isValidId(String(id_vehiculo))) throwError('El id_vehiculo debe ser un número válido.', 400);
    if (fecha_entrada !== undefined && !isValidDate(fecha_entrada)) throwError('La fecha de entrada debe ser una fecha válida.', 400);
    if (fecha_salida !== undefined && !isValidDate(fecha_salida)) throwError('La fecha de salida debe ser una fecha válida.', 400);
    if (dia !== undefined && !isValidDiaSemana(dia)) throwError('El dia debe ser un valor valido: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.', 400);

    const data = await svc.updateAsync(parseInt(req.params.id, 10), body, req.usuario);
    if (!data) throwError('No encontrado: La reserva con ese ID no existe.', 404);
    res.status(200).json(data);
});

// DELETE (admin o smartlot)
router.delete('/:id', authMiddleware, requireRole(1, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const ok = await svc.deleteAsync(id, req.usuario);
    if (!ok) throwError('No encontrado: La reserva con ese ID no existe.', 404);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

// POST CANCEL (admin, smartlot o cliente dueño de la reserva)
router.post('/:id/cancel', authMiddleware, requireRole(1, 2, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const ok = await svc.cancelarAsync(id, req.usuario);
    if (!ok) throwError('No encontrado: La reserva con ese ID no existe.', 404);
    res.status(200).json({ message: 'Reserva cancelada exitosamente.' });
});

// POST CHECK-IN (admin, smartlot o garagista)
// Esta ruta estatica debe declararse antes de /:id/check-in.
router.post('/qr/check-in', requireRole(1, 3, 4), async (req, res) => {
    const data = await svc.checkInByQrAsync(req.body?.qr, req.usuario);
    res.status(200).json(data);
});

router.post('/:id/check-in', authMiddleware, requireRole(1, 3, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.checkInAsync(id, req.body?.patente, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// POST CHECK-OUT (admin, smartlot o garagista)
router.post('/qr/check-out', requireRole(1, 3, 4), async (req, res) => {
    const data = await svc.checkOutByQrAsync(req.body?.qr, req.usuario);
    res.status(200).json(data);
});

router.post('/:id/check-out', authMiddleware, requireRole(1, 3, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.checkOutAsync(id, req.body?.patente, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

export default router;

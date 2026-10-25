import { Router } from 'express';
import ReservaService from './../services/reservaService.js';
import { idParam, isValidId, isValidDate, isValidDiaSemana } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { throwError } from '../helpers/httpError.js';

const router = Router();
const svc = new ReservaService();

router.param('id', idParam());
router.param('id_garage', idParam('ID de garage'));
router.param('id_usuario', idParam('ID de usuario'));

/**
 * Convencion de roles (verificar contra la tabla `roles`):
 *   1 = admin
 *   2 = cliente
 *   3 = garagista
 */

// GET ALL
router.get('', async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    res.status(200).json(data);
});

// GET DISPONIBILIDAD POR HORA
router.get('/disponibilidad-por-hora', async (req, res) => {
    const fecha = req.query.fecha;

    if (!isValidId(req.query.garage_id)) throwError('El garage_id es requerido y debe ser un número válido.', 400);
    const garage_id = Number(req.query.garage_id);
    if (!fecha) throwError('La fecha es requerida (formato YYYY-MM-DD).', 400);

    const data = await svc.getDisponibilidadPorHoraAsync(garage_id, fecha);
    res.status(200).json(data);
});

router.post('/cotizacion', requireRole(2), async (req, res) => {
    res.status(200).json(await svc.quoteAsync(req.body ?? {}, req.usuario));
});

// GET CONTROL DE ACCESO (admin, smartlot o garagista del garage)
router.get('/control-acceso/:id_garage', requireRole(1, 3, 4), async (req, res) => {
    const idGarage = req.params.id_garage;
    const fecha = String(req.query.fecha ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !isValidDate(`${fecha}T00:00:00`)) {
        throwError('La fecha es requerida (formato YYYY-MM-DD).', 400);
    }

    const data = await svc.getControlAccesoAsync(idGarage, fecha, req.usuario);
    res.status(200).json(data);
});

// GET BY USER
router.get('/usuario/:id_usuario', async (req, res) => {
    const { id_usuario } = req.params;

    // Verificación de propiedad: solo el propio usuario, un admin o un superadmin
    // pueden consultar las reservas de un usuario (evita enumeración entre tenants).
    const rol = Number(req.usuario.id_rol);
    if (rol !== 1 && rol !== 4 && Number(req.usuario.id) !== id_usuario) {
        throwError('No tiene permisos para ver las reservas de este usuario.', 403);
    }

    const data = await svc.getByUsuarioWithDetailsAsync(id_usuario, req.usuario);
    res.status(200).json(data);
});

// GET QR DE RESERVA (solo cliente/empleado titular)
router.get('/:id/qr', requireRole(2), async (req, res) => {
    const { id } = req.params;

    const data = await svc.getQrAsync(id, req.usuario);
    res.set('Cache-Control', 'no-store');
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
router.post('', requireRole(2), async (req, res) => {
    const body = req.body ?? {};

    const { id_garage, id_vehiculo, fecha_entrada, fecha_salida, dia } = body;
    if (!isValidId(String(id_garage))) throwError('El id_garage es requerido y debe ser un número válido.', 400);
    if (!isValidId(String(id_vehiculo))) throwError('El id_vehiculo es requerido y debe ser un número válido.', 400);
    if (!isValidDate(fecha_entrada)) throwError('La fecha de entrada es requerida y debe ser una fecha válida.', 400);
    if (!isValidDate(fecha_salida)) throwError('La fecha de salida es requerida y debe ser una fecha válida.', 400);
    if (!dia || !isValidDiaSemana(dia)) throwError('El dia es requerido y debe ser un valor valido: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.', 400);

    const data = await svc.createAsync(body, req.usuario);
    res.status(201).json(data);
});

// UPDATE (PUT)
router.put('/:id', async (req, res) => {
    const body = req.body ?? {};

    // El titular no se edita por acá: reservaService conserva solo los campos de su lista blanca.
    const { id_garage, id_vehiculo, fecha_entrada, fecha_salida, dia } = body;
    if (id_garage !== undefined && !isValidId(String(id_garage))) throwError('El id_garage debe ser un número válido.', 400);
    if (id_vehiculo !== undefined && !isValidId(String(id_vehiculo))) throwError('El id_vehiculo debe ser un número válido.', 400);
    if (fecha_entrada !== undefined && !isValidDate(fecha_entrada)) throwError('La fecha de entrada debe ser una fecha válida.', 400);
    if (fecha_salida !== undefined && !isValidDate(fecha_salida)) throwError('La fecha de salida debe ser una fecha válida.', 400);
    if (dia !== undefined && !isValidDiaSemana(dia)) throwError('El dia debe ser un valor valido: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.', 400);

    const data = await svc.updateAsync(req.params.id, body, req.usuario);
    if (!data) throwError('No encontrado: La reserva con ese ID no existe.', 404);
    res.status(200).json(data);
});

// DELETE (admin o smartlot)
router.delete('/:id', requireRole(1, 4), async (req, res) => {
    const { id } = req.params;

    const ok = await svc.deleteAsync(id, req.usuario);
    if (!ok) throwError('No encontrado: La reserva con ese ID no existe.', 404);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

// POST CANCEL (admin, smartlot o cliente dueño de la reserva)
router.post('/:id/cancel', requireRole(1, 2, 4), async (req, res) => {
    const { id } = req.params;

    const ok = await svc.cancelarAsync(id, req.usuario);
    if (!ok) throwError('No encontrado: La reserva con ese ID no existe.', 404);
    res.status(200).json({ message: 'Reserva cancelada exitosamente.' });
});

// POST LIBERAR RETENCION (admin, smartlot o cliente dueno de la reserva)
// Suelta el lugar retenido por una reserva pendiente de pago cuando el
// empleado no concreta el pago, sin la ventana de 30 minutos del cancel.
router.post('/:id/liberar-retencion', requireRole(1, 2, 4), async (req, res) => {
    const { id } = req.params;

    await svc.liberarRetencionAsync(id, req.usuario);
    res.status(200).json({ message: 'El lugar retenido fue liberado.' });
});

// POST CHECK-IN (admin, smartlot o garagista)
// Esta ruta estatica debe declararse antes de /:id/check-in.
router.post('/qr/check-in', requireRole(1, 3, 4), async (req, res) => {
    const data = await svc.checkInByQrAsync(req.body?.qr, req.usuario);
    res.status(200).json(data);
});

router.post('/:id/check-in', requireRole(1, 3, 4), async (req, res) => {
    const { id } = req.params;

    const data = await svc.checkInAsync(id, req.body?.patente, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// POST CHECK-OUT (admin, smartlot o garagista)
router.post('/qr/check-out', requireRole(1, 3, 4), async (req, res) => {
    const data = await svc.checkOutByQrAsync(req.body?.qr, req.usuario);
    res.status(200).json(data);
});

router.post('/:id/check-out', requireRole(1, 3, 4), async (req, res) => {
    const { id } = req.params;

    const data = await svc.checkOutAsync(id, req.body?.patente, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

export default router;

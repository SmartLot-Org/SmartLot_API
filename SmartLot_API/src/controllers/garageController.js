import { Router } from 'express';
import GarageService from './../services/garageService.js';
import { obtenerGaragesCercanosConTiempoReal, obtenerDistanciaEntrePuntos } from './../services/geolocalizacionService.js';
import { isValidId, isValidString, isValidPositiveNumber, isValidTime, isValidDiaSemana } from '../helpers/validatorHelper.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import { ROLE_NAMES } from '../helpers/roles.js';

const router = Router();
const svc = new GarageService();

function throwError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

function validatePrices(prices) {
    for (const [campo, valor] of Object.entries(prices)) {
        if (valor !== undefined && valor !== null && (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0)) {
            throwError(`${campo} debe ser un numero mayor o igual a 0.`, 400);
        }
    }
}

async function assertGarageControl(req, id) {
    const garage = await svc.getByIdAsync(id, req.usuario);
    if (!garage) throwError('No encontrado o sin permisos sobre el garage.', 404);
}

// GET ALL
router.get('', async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    if (!data) throwError('Error interno del servidor', 500);
    res.status(200).json(data);
});

// Descubrimiento para administradores. No concede permisos de edición.
router.get('/cercanos', requireRole(1, 4, ROLE_NAMES.ADMIN, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    const sedeId = Number(req.query.sede_id);
    const radioKm = req.query.radio_km === undefined ? 50 : Number(req.query.radio_km);
    if (!Number.isInteger(sedeId) || sedeId <= 0) throwError('sede_id debe ser un entero valido.', 400);
    if (!Number.isFinite(radioKm) || radioKm <= 0 || radioKm > 100) throwError('radio_km debe estar entre 0 y 100.', 400);
    const sede = await svc.sedeService.getByIdAsync(sedeId, req.usuario);
    if (!sede) throwError('Sede no encontrada o sin permisos.', 404);
    if (!sede.latitud || !sede.longitud) throwError('La sede no tiene coordenadas registradas.', 400);
    res.status(200).json(await obtenerGaragesCercanosConTiempoReal(
        Number(sede.latitud), Number(sede.longitud), radioKm, sedeId
    ));
});

// GET OCUPACION RESERVA BY ID
router.get('/ocupacion_reserva/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.getOcupacionReservaAsync(id);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// GET OCUPACION NO RESERVA BY ID
router.get('/ocupacion_no_reserva/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.getOcupacionNoReservaAsync(id);
    if (!data) throwError('No encontrado.', 404);
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

// GET CERCANOS - Garages cercanos con tiempos reales usando Distance Matrix
router.get('/:id/cercanos', requireRole(1, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const sede = await svc.sedeService.getByIdAsync(id);
    if (!sede) throwError('Sede no encontrada.', 404);
    if (!sede.latitud || !sede.longitud) throwError('La sede no tiene coordenadas registradas.', 400);

    const garages = await obtenerGaragesCercanosConTiempoReal(
        parseFloat(sede.latitud),
        parseFloat(sede.longitud)
    );

    res.status(200).json(garages);
});

// GET DISTANCIA A SEDE - La sede es solo una referencia, no pertenece al garage.
router.get('/:id/distancia-sede', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const garage = await svc.getByIdAsync(id, req.usuario);
    if (!garage) {
        console.error(`distancia-sede: garage ${id} no encontrado (usuario ${req.usuario?.id})`);
        throwError('Garage no encontrado.', 404);
    }
    if (!garage.latitud || !garage.longitud) throwError('El garage no tiene coordenadas registradas.', 400);

    const sedeId = Number(req.query.sede_id ?? req.usuario?.id_sede);
    if (!Number.isInteger(sedeId) || sedeId <= 0) throwError('sede_id debe ser un entero valido.', 400);
    const sede = await svc.sedeService.getByIdAsync(sedeId, req.usuario);
    if (!sede) {
        console.error(`distancia-sede: sede ${sedeId} no encontrada o sin permisos para garage ${id}`);
        throwError('Sede no encontrada o sin permisos.', 404);
    }
    if (!sede.latitud || !sede.longitud) throwError('La sede no tiene coordenadas registradas.', 400);

    const resultado = await obtenerDistanciaEntrePuntos(
        parseFloat(sede.latitud), parseFloat(sede.longitud),
        parseFloat(garage.latitud), parseFloat(garage.longitud)
    );

    res.status(200).json({
        garage: {
            id: garage.id,
            nombre: garage.nombre || garage.nombre_garage || garage.ubicacion,
            ubicacion: garage.ubicacion || '',
            latitud: parseFloat(garage.latitud),
            longitud: parseFloat(garage.longitud),
        },
        sede: {
            id: sede.id,
            nombre: sede.nombre || '',
            ubicacion: sede.ubicacion || '',
            latitud: parseFloat(sede.latitud),
            longitud: parseFloat(sede.longitud),
        },
        distancia: resultado,
    });
});

// CREATE (POST)
router.post('', requireRole(4, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    const { nombre, piso, ubicacion, latitud, longitud, capacidad, capacidad_reservas, capacidad_para_no_reservas, estado, hora_apertura, hora_cierre, dias, precio_pickup, precio_auto, precio_moto } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', 400);
    if (!isValidPositiveNumber(capacidad)) throwError('La capacidad debe ser un número positivo.', 400);
    if (estado !== undefined && typeof estado !== 'boolean') throwError('El estado debe ser un valor booleano (true o false).', 400);
    if (hora_apertura !== undefined && hora_apertura !== null && !isValidTime(hora_apertura)) throwError('La hora de apertura debe tener formato HH:MM.', 400);
    if (hora_cierre !== undefined && hora_cierre !== null && !isValidTime(hora_cierre)) throwError('La hora de cierre debe tener formato HH:MM.', 400);
    if (hora_apertura && hora_cierre && hora_apertura >= hora_cierre) throwError('La hora de apertura debe ser anterior a la hora de cierre.', 400);
    if (!Array.isArray(dias) || dias.length === 0) throwError('Debe proporcionar al menos un dia disponible para el garage.', 400);
    for (const dia of dias) {
        if (!isValidDiaSemana(dia)) throwError(`El dia "${dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`, 400);
    }
    validatePrices({ precio_pickup, precio_auto, precio_moto });

    // Lista blanca de campos: evita asignación masiva de contadores de ocupación.
    const safeEntity = {
        nombre, piso, ubicacion, latitud, longitud,
        capacidad, capacidad_reservas, capacidad_para_no_reservas, estado, hora_apertura, hora_cierre, dias, precio_pickup, precio_auto, precio_moto
    };
    const data = await svc.createAsync({ ...safeEntity, id_dueno: req.body.id_dueno, id_garagistas: req.body.id_garagistas }, req.usuario);
    if (!data) throwError('Error interno al crear el garage.', 500);
    res.status(201).json(data);
});

// UPDATE (PUT)
router.put('/:id', requireRole(4, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    if (!isValidId(req.params.id)) throwError('El ID proporcionado no es válido.', 400);
    await assertGarageControl(req, Number(req.params.id));
    const { nombre, piso, ubicacion, latitud, longitud, capacidad, capacidad_reservas, capacidad_para_no_reservas, estado, hora_apertura, hora_cierre, dias, precio_pickup, precio_auto, precio_moto } = req.body;
    if (nombre !== undefined && !isValidString(nombre)) throwError('El nombre no puede estar vacío.', 400);
    if (capacidad !== undefined && (typeof capacidad !== 'number' || capacidad < 0)) throwError('La capacidad debe ser un número mayor o igual a 0.', 400);
    if (estado !== undefined && typeof estado !== 'boolean') throwError('El estado debe ser un valor booleano (true o false).', 400);
    if (hora_apertura !== undefined && hora_apertura !== null && !isValidTime(hora_apertura)) throwError('La hora de apertura debe tener formato HH:MM.', 400);
    if (hora_cierre !== undefined && hora_cierre !== null && !isValidTime(hora_cierre)) throwError('La hora de cierre debe tener formato HH:MM.', 400);
    if (hora_apertura && hora_cierre && hora_apertura >= hora_cierre) throwError('La hora de apertura debe ser anterior a la hora de cierre.', 400);
    if (dias !== undefined) {
        if (!Array.isArray(dias) || dias.length === 0) throwError('Debe proporcionar al menos un dia disponible para el garage.', 400);
        for (const dia of dias) {
            if (!isValidDiaSemana(dia)) throwError(`El dia "${dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`, 400);
        }
    }
    validatePrices({ precio_pickup, precio_auto, precio_moto });

    // Lista blanca de campos: evita asignación masiva de contadores de ocupación.
    const safeEntity = {
        nombre, piso, ubicacion, latitud, longitud,
        capacidad, capacidad_reservas, capacidad_para_no_reservas, estado, hora_apertura, hora_cierre, dias, precio_pickup, precio_auto, precio_moto
    };
    const data = await svc.updateAsync(parseInt(req.params.id, 10), safeEntity);
    if (!data) throwError('No encontrado: El garage con ese ID no existe.', 404);
    res.status(200).json(data);
});

// GET DIAS BY GARAGE ID
router.get('/:id/dias', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.getDiasAsync(id);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json({ id_garage: id, dias: data });
});

// POST ADD DIA TO GARAGE
router.post('/:id/dias', requireRole(4, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);
    await assertGarageControl(req, id);

    const { dia } = req.body;
    if (!dia || !isValidDiaSemana(dia)) throwError(`El dia "${dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`, 400);

    const data = await svc.addDiaAsync(id, dia);
    if (!data) throwError('El dia ya estaba registrado o el garage no existe.', 400);
    res.status(201).json({ message: `Dia ${dia} agregado exitosamente.` });
});

// DELETE DIA FROM GARAGE
router.delete('/:id/dias/:dia', requireRole(4, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);
    await assertGarageControl(req, id);

    const { dia } = req.params;
    if (!isValidDiaSemana(dia)) throwError(`El dia "${dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`, 400);

    const ok = await svc.removeDiaAsync(id, dia);
    if (!ok) throwError('El dia no estaba registrado o el garage no existe.', 404);
    res.status(200).json({ message: `Dia ${dia} eliminado exitosamente.` });
});

// DELETE
router.delete('/:id', requireRole(4, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);
    await assertGarageControl(req, id);

    const ok = await svc.deleteAsync(id);
    if (!ok) throwError('No encontrado: El garage con ese ID no existe.', 404);
    res.status(200).json({ message: 'Eliminado exitosamente.' });
});

// RESTORE
router.patch('/:id/restaurar', requireRole(4, ROLE_NAMES.DUENO_GARAGE, ROLE_NAMES.SUPERADMIN), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.restoreAsync(id, req.usuario);
    if (!data) throwError('No encontrado: El garage no existe en tu papelera.', 404);
    res.status(200).json(data);
});

// POST INGRESO VEHICULO SIN RESERVA
router.post('/:id/ingreso-no-reserva', requireRole(1, 3, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.registrarIngresoNoReservaAsync(id);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// POST EGRESO VEHICULO SIN RESERVA
router.post('/:id/egreso-no-reserva', requireRole(1, 3, 4), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const data = await svc.registrarEgresoNoReservaAsync(id);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

export default router;

// reservaService.js
import pool from '../database/db.js';
import ReservaRepository from '../repositories/reservaRepository.js';
import UsuarioService from './usuarioService.js';
import GarageService from './garageService.js';
import VehiculoService from './vehiculoService.js';
import { isValidDiaSemana } from '../helpers/validatorHelper.js';
import CuentaCorrienteRepository from '../repositories/cuentaCorrienteRepository.js';

export default class ReservaService {
    constructor() {
        console.log('Estoy en: ReservaService.constructor()');
        this.repo = new ReservaRepository();
        this.usuarioService = new UsuarioService();
        this.garageService = new GarageService();
        this.vehiculoService = new VehiculoService();
        this.cuentaCorrienteRepo = new CuentaCorrienteRepository();
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);

    getControlAccesoAsync = async (id_garage, fecha, requestingUser) => {
        await this._validarAccesoGarageAsync(id_garage, requestingUser);
        const reservas = await this.repo.getControlAccesoAsync(id_garage, fecha, requestingUser);
        if (!reservas) {
            const error = new Error('No se pudieron obtener las reservas para control de acceso.');
            error.statusCode = 500;
            throw error;
        }
        return reservas;
    }

    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    getActivasByUsuarioAsync = async (id_usuario) => await this.repo.getActivasByUsuarioAsync(id_usuario);

    getByUsuarioAsync = async (id_usuario, requestingUser = null) => await this.repo.getByUsuarioAsync(id_usuario, requestingUser);

    getByUsuarioWithDetailsAsync = async (id_usuario, requestingUser = null) => {
        const rows = await this.repo.getByUsuarioWithDetailsAsync(id_usuario, requestingUser);
        if (!rows) return null;

        return rows.map((r) => {
            const fechaEntrada = r.fecha_entrada ? new Date(r.fecha_entrada) : null;
            const fechaSalida = r.fecha_salida ? new Date(r.fecha_salida) : null;

            const pad = (n) => String(n).padStart(2, "0");

            const fechaStr = fechaEntrada
                ? `${fechaEntrada.getFullYear()}-${pad(fechaEntrada.getMonth() + 1)}-${pad(fechaEntrada.getDate())}`
                : null;

            const horaEntrada = fechaEntrada
                ? `${pad(fechaEntrada.getHours())}:${pad(fechaEntrada.getMinutes())}`
                : null;

            const horaSalida = fechaSalida
                ? `${pad(fechaSalida.getHours())}:${pad(fechaSalida.getMinutes())}`
                : null;

            const nombreZona = r.garage_piso || r.garage_ubicacion || null;
            const nroPlaza = r.garage_ubicacion || null;

            const entrada = !!r.entro;
            const salida = !!r.salio;
            const borrado = !!r.Borrado;

            let estado = "Registro";
            if (borrado) {
                estado = "Cancelada";
            } else if (entrada && salida) {
                estado = "Completada";
            }

            return {
                id_reserva: r.id,
                id: r.id,
                id_usuario: r.id_usuario,
                fecha: fechaStr,
                hora_entrada: horaEntrada,
                hora_salida: horaSalida,
                nombre_garage: r.garage_nombre || null,
                nombre_zona: nombreZona,
                nro_plaza: nroPlaza,
                entrada,
                salida,
                entro: r.entro,
                salio: r.salio,
                borrado,
                estado,
                vehiculo: r.patente
                    ? { patente: r.patente, marca: r.marca_nombre, modelo: r.modelo_nombre }
                    : null,
            };
        });
    }

    usuarioTieneReservasActivasAsync = async (id_usuario) => {
        const reservas = await this.repo.getActivasByUsuarioAsync(id_usuario);
        return reservas !== null && reservas.length > 0;
    }

    createAsync = async (entity, requestingUser) => {
        const rol = Number(requestingUser.id_rol);
        if (rol !== 1 && rol !== 4) {
            entity.id_usuario = requestingUser.id;
        }

        this._validarCamposObligatorios(entity);
        await this._validarRelacionesAsync(entity, requestingUser);
        this._validarFechasAsync(entity);
        await this._validarDisponibilidadAsync(entity);
        await this._validarMaximoReservasDiariasAsync(entity);

        entity.entro = false;
        entity.salio = false;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const reserva = await this.repo.createWithClientAsync(entity, client);
            if (!reserva) {
                const error = new Error('Error interno al crear la reserva.');
                error.statusCode = 500;
                throw error;
            }

            await client.query('COMMIT');
            return reserva;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('ROLLBACK falló:', rollbackError); }
            throw error;
        } finally {
            client.release();
        }
    }

    updateAsync = async (id, entity, requestingUser) => {
        const rol = Number(requestingUser.id_rol);
        if (rol !== 1 && rol !== 4) {
            delete entity.id_usuario;
        }

        const current = await this.repo.getByIdAsync(id);
        if (!current) {
            const error = new Error(`La reserva con ID ${id} no existe.`);
            error.statusCode = 404;
            throw error;
        }

        if (rol !== 1 && rol !== 4 && Number(current.id_usuario) !== Number(requestingUser.id)) {
            const error = new Error('No tiene permisos para modificar esta reserva.');
            error.statusCode = 403;
            throw error;
        }

        if (Object.keys(entity).length === 0) {
            const error = new Error('Debe enviar al menos un campo para actualizar la reserva.');
            error.statusCode = 400;
            throw error;
        }

        if (current.salio) {
            const error = new Error(`La reserva con ID ${id} ya fue finalizada y no puede modificarse.`);
            error.statusCode = 400;
            throw error;
        }

        if (current.entro) {
            const error = new Error(`La reserva con ID ${id} ya registro su ingreso y no puede modificarse.`);
            error.statusCode = 400;
            throw error;
        }

        const ahora = new Date();
        const fechaEntradaActual = new Date(current.fecha_entrada);
        const limiteModificacion = new Date(fechaEntradaActual.getTime() - 30 * 60 * 1000);
        if (ahora >= limiteModificacion) {
            const error = new Error(`La reserva con ID ${id} esta demasiado proxima a su inicio para ser modificada.`);
            error.statusCode = 400;
            throw error;
        }

        const mergedEntity = { ...current, ...entity };

        this._validarCamposObligatorios(mergedEntity);
        await this._validarRelacionesAsync(mergedEntity, requestingUser);
        this._validarFechasAsync(mergedEntity);
        await this._validarDisponibilidadAsync(mergedEntity, id);
        await this._validarMaximoReservasDiariasAsync(mergedEntity, id);

        return await this.repo.updateAsync(id, mergedEntity);
    }

    deleteAsync = async (id, requestingUser = null) => await this.cancelarAsync(id, requestingUser);

    cancelarAsync = async (id, requestingUser = null) => {
        const reserva = await this.repo.getByIdAsync(id);
        if (!reserva) {
            const error = new Error(`La reserva con ID ${id} no existe.`);
            error.statusCode = 404;
            throw error;
        }

        if (requestingUser) {
            const rol = Number(requestingUser.id_rol);
            if (rol !== 1 && rol !== 4 && Number(reserva.id_usuario) !== Number(requestingUser.id)) {
                const error = new Error('No tiene permisos para cancelar esta reserva.');
                error.statusCode = 403;
                throw error;
            }
        }

        if (reserva.entro && !reserva.salio) {
            const error = new Error(`La reserva con ID ${id} ya registro su ingreso. Debe registrar la salida antes de cancelarla.`);
            error.statusCode = 400;
            throw error;
        }

        const ahora = new Date();
        const fechaEntrada = new Date(reserva.fecha_entrada);
        const limiteCancelacion = new Date(fechaEntrada.getTime() - 30 * 60 * 1000);
        if (ahora >= limiteCancelacion) {
            const error = new Error(`La reserva con ID ${id} esta demasiado proxima a su inicio para ser cancelada.`);
            error.statusCode = 400;
            throw error;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const cancelada = await this.repo.cancelarWithClientAsync(id, client);
            if (!cancelada) {
                const error = new Error(`Error interno al cancelar la reserva con ID ${id}.`);
                error.statusCode = 500;
                throw error;
            }

            if (reserva.entro && !reserva.salio) {
                const updatedGarage = await this.garageService.decrementOcupacionReservasWithClientAsync(reserva.id_garage, client);
                if (!updatedGarage) {
                    const error = new Error(`Error al liberar la ocupacion del garage.`);
                    error.statusCode = 500;
                    throw error;
                }
            }

            await client.query('COMMIT');
            return true;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('ROLLBACK falló:', rollbackError); }
            throw error;
        } finally {
            client.release();
        }
    }

    checkInAsync = async (id, patente, requestingUser) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const reserva = await this.repo.getByIdForUpdateWithClientAsync(id, client);
            await this._validarReservaParaAccesoAsync(reserva, id, patente, requestingUser);

            if (reserva.entro) {
                const error = new Error(`La reserva con ID ${id} ya registro su ingreso.`);
                error.statusCode = 400;
                throw error;
            }

            if (reserva.salio) {
                const error = new Error(`La reserva con ID ${id} ya registro su salida.`);
                error.statusCode = 400;
                throw error;
            }

            const ahora = new Date();
            const fechaEntrada = new Date(reserva.fecha_entrada);
            const ingresoPermitidoDesde = new Date(fechaEntrada.getTime() - 60 * 60 * 1000);

            if (ahora < ingresoPermitidoDesde) {
                const error = new Error(`La reserva con ID ${id} todavia no esta habilitada para registrar ingreso.`);
                error.statusCode = 400;
                throw error;
            }

            if (ahora > new Date(reserva.fecha_salida)) {
                const error = new Error(`La reserva con ID ${id} ya supero su horario de salida previsto.`);
                error.statusCode = 400;
                throw error;
            }

            const garage = await this.garageService.getByIdForUpdateWithClientAsync(reserva.id_garage, client);
            if (!garage) {
                const error = new Error(`El garage no existe.`);
                error.statusCode = 400;
                throw error;
            }

            this._validarGarageDisponible(garage);
            this._validarCapacidadTotalActualGarage(garage);

            const updatedReserva = await this.repo.registrarIngresoWithClientAsync(id, client);
            if (!updatedReserva) {
                const error = new Error('Error al registrar el ingreso de la reserva.');
                error.statusCode = 500;
                throw error;
            }

            const updatedGarage = await this.garageService.incrementOcupacionReservasWithClientAsync(reserva.id_garage, client);
            if (!updatedGarage) {
                const error = new Error(`El garage no tiene capacidad disponible para registrar el ingreso.`);
                error.statusCode = 400;
                throw error;
            }

            await client.query('COMMIT');
            return updatedReserva;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('ROLLBACK falló:', rollbackError); }
            throw error;
        } finally {
            client.release();
        }
    }

    checkOutAsync = async (id, patente, requestingUser) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const reserva = await this.repo.getByIdForUpdateWithClientAsync(id, client);
            await this._validarReservaParaAccesoAsync(reserva, id, patente, requestingUser);

            if (!reserva.entro) {
                const error = new Error(`La reserva con ID ${id} no puede registrar salida sin haber registrado su ingreso.`);
                error.statusCode = 400;
                throw error;
            }

            if (reserva.salio) {
                const error = new Error(`La reserva con ID ${id} ya registro su salida.`);
                error.statusCode = 400;
                throw error;
            }

            const garage = await this.garageService.getByIdForUpdateWithClientAsync(reserva.id_garage, client);
            if (!garage) {
                const error = new Error(`El garage no existe.`);
                error.statusCode = 400;
                throw error;
            }

            const updatedReserva = await this.repo.registrarSalidaWithClientAsync(id, client);
            if (!updatedReserva) {
                const error = new Error('Error al registrar la salida de la reserva.');
                error.statusCode = 500;
                throw error;
            }

            const consumo = await this.cuentaCorrienteRepo.crearConsumoReservaAsync(id, client);
            if (!consumo) {
                const error = new Error('No se pudo generar el consumo: verifique la sede, el trato y la tarifa del tipo de vehiculo.');
                error.statusCode = 409;
                throw error;
            }

            const updatedGarage = await this.garageService.decrementOcupacionReservasWithClientAsync(reserva.id_garage, client);
            if (!updatedGarage) {
                const error = new Error(`La ocupacion de reservas del garage ya esta en cero.`);
                error.statusCode = 400;
                throw error;
            }

            await client.query('COMMIT');
            return updatedReserva;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('ROLLBACK falló:', rollbackError); }
            throw error;
        } finally {
            client.release();
        }
    }

    _validarAccesoGarageAsync = async (id_garage, requestingUser) => {
        const rol = Number(requestingUser?.id_rol);
        if (rol === 3 && Number(requestingUser?.id_garage) !== Number(id_garage)) {
            const error = new Error('No tiene permisos para operar este garage.');
            error.statusCode = 403;
            throw error;
        }

        const garage = await this.garageService.getByIdAsync(id_garage, requestingUser);
        if (!garage) {
            const error = new Error('El garage no existe o no pertenece a su organizacion.');
            error.statusCode = 404;
            throw error;
        }
    }

    _validarReservaParaAccesoAsync = async (reserva, id, patente, requestingUser) => {
        if (!reserva) {
            const error = new Error(`La reserva con ID ${id} no existe.`);
            error.statusCode = 404;
            throw error;
        }

        if (Number(requestingUser?.id_rol) === 3
            && Number(requestingUser?.id_garage) !== Number(reserva.id_garage)) {
            const error = new Error('No tiene permisos para operar reservas de otro garage.');
            error.statusCode = 403;
            throw error;
        }

        if (Number(requestingUser?.id_rol) !== 4) {
            const garageAutorizado = await this.garageService.getByIdAsync(reserva.id_garage, requestingUser);
            if (!garageAutorizado) {
                const error = new Error('No tiene permisos para operar reservas de otra organizacion.');
                error.statusCode = 403;
                throw error;
            }
        }

        const normalizar = (valor) => String(valor ?? '').trim().replace(/[\s-]/g, '').toUpperCase();
        if (!normalizar(patente) || normalizar(patente) !== normalizar(reserva.patente)) {
            const error = new Error('La patente ingresada no coincide con el vehiculo de la reserva.');
            error.statusCode = 400;
            throw error;
        }
    }

    getDisponibilidadPorHoraAsync = async (garage_id, fecha) => {
        const garage = await this.garageService.getByIdAsync(garage_id);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }

        const capacidadReservas = garage.capacidad_reservas !== null && garage.capacidad_reservas !== undefined
            ? garage.capacidad_reservas
            : (garage.capacidad || 0);

        const apertura = (garage.hora_apertura || '00:00').split(':').map(Number);
        const cierre = (garage.hora_cierre || '23:59').split(':').map(Number);
        const aperturaMinutos = apertura[0] * 60 + apertura[1];
        const cierreMinutos = cierre[0] * 60 + cierre[1];

        const reservas = await this.repo.getOverlapByGarageAndDateAsync(garage_id, fecha) || [];

        const horas = [];
        for (let m = aperturaMinutos; m < cierreMinutos; m += 60) {
            const hh = String(Math.floor(m / 60)).padStart(2, '0');
            const mm = String(m % 60).padStart(2, '0');
            const horaStr = `${hh}:${mm}`;

            const horaDate = new Date(`${fecha}T${horaStr}:00`);
            const horaFinDate = new Date(horaDate.getTime() + 60 * 60 * 1000);

            let count = 0;
            for (const r of reservas) {
                const rEntrada = new Date(r.fecha_entrada);
                const rSalida = new Date(r.fecha_salida);
                if (rEntrada < horaFinDate && rSalida > horaDate) {
                    count++;
                }
            }

            horas.push({
                hora: horaStr,
                reservas: count,
                disponibles: Math.max(capacidadReservas - count, 0),
            });
        }

        return {
            garage_id: Number(garage_id),
            fecha,
            capacidad_reservas: capacidadReservas,
            horas,
        };
    }

    _validarCamposObligatorios = (entity) => {
        const errores = [];

        if (!entity.id_usuario) errores.push('El id_usuario es requerido.');
        if (!entity.id_garage) errores.push('El id_garage es requerido.');
        if (!entity.id_vehiculo) errores.push('El id_vehiculo es requerido.');
        if (!entity.fecha_entrada) errores.push('La fecha de entrada es requerida.');
        if (!entity.fecha_salida) errores.push('La fecha de salida es requerida.');
        if (!entity.dia) errores.push('El dia es requerido.');

        if (errores.length > 0) {
            const error = new Error(errores.join(' '));
            error.statusCode = 400;
            throw error;
        }

        if (entity.dia && !isValidDiaSemana(entity.dia)) {
            const error = new Error(`El dia "${entity.dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`);
            error.statusCode = 400;
            throw error;
        }
    }

    _validarRelacionesAsync = async (entity, requestingUser = null) => {
        const errores = [];
        let usuario = null;
        let garage = null;
        let vehiculo = null;

        if (entity.id_usuario) {
            usuario = await this.usuarioService.getByIdAsync(entity.id_usuario);
            if (!usuario) {
                errores.push(`El usuario con ID ${entity.id_usuario} no existe.`);
            } else if (usuario.activo === false) {
                errores.push(`El usuario con ID ${entity.id_usuario} esta inactivo.`);
            }
        }

        if (entity.id_garage) {
            garage = await this.garageService.getByIdAsync(entity.id_garage, requestingUser);
            if (!garage) {
                errores.push(`El garage no existe.`);
            } else {
                try {
                    this._validarGarageDisponible(garage);
                } catch (error) {
                    errores.push(error.message);
                }
            }
        }

        if (entity.id_vehiculo) {
            vehiculo = await this.vehiculoService.getByIdAsync(entity.id_vehiculo);
            if (!vehiculo) {
                errores.push(`El vehiculo con ID ${entity.id_vehiculo} no existe.`);
            } else if (usuario && vehiculo.id_usuario !== usuario.id) {
                errores.push(`El vehiculo con ID ${entity.id_vehiculo} no pertenece al usuario con ID ${entity.id_usuario}.`);
            }
        }

        if (errores.length > 0) {
            const error = new Error(errores.join(' '));
            error.statusCode = 400;
            throw error;
        }
    }

    _validarFechasAsync = (entity) => {
        const fechaEntrada = new Date(entity.fecha_entrada);
        const fechaSalida = new Date(entity.fecha_salida);

        if (isNaN(fechaEntrada.getTime())) {
            const error = new Error('La fecha de entrada debe ser una fecha valida.');
            error.statusCode = 400;
            throw error;
        }

        if (isNaN(fechaSalida.getTime())) {
            const error = new Error('La fecha de salida debe ser una fecha valida.');
            error.statusCode = 400;
            throw error;
        }

        if (fechaEntrada < new Date()) {
            const error = new Error('La fecha de entrada no puede ser en el pasado.');
            error.statusCode = 400;
            throw error;
        }

        if (fechaSalida <= fechaEntrada) {
            const error = new Error('La fecha de salida debe ser posterior a la fecha de entrada.');
            error.statusCode = 400;
            throw error;
        }

        const DURACION_MINIMA_MS = 30 * 60 * 1000;
        if (fechaSalida - fechaEntrada < DURACION_MINIMA_MS) {
            const error = new Error('La reserva debe tener una duracion minima de 30 minutos.');
            error.statusCode = 400;
            throw error;
        }

        const DURACION_MAXIMA_MS = 12 * 60 * 60 * 1000;
        if (fechaSalida - fechaEntrada > DURACION_MAXIMA_MS) {
            const error = new Error('La reserva no puede superar las 12 horas de duracion.');
            error.statusCode = 400;
            throw error;
        }

        const ANTELACION_MINIMA_MS = 30 * 60 * 1000;
        if (fechaEntrada.getTime() - Date.now() < ANTELACION_MINIMA_MS) {
            const error = new Error('La reserva debe hacerse con al menos 30 minutos de antelacion.');
            error.statusCode = 400;
            throw error;
        }
    }

    _validarDisponibilidadAsync = async (entity, excludeId = null) => {
        const overlapUsuario = await this.repo.getOverlapByUsuarioAsync(
            entity.id_usuario,
            entity.fecha_entrada,
            entity.fecha_salida,
            excludeId
        );
        if (overlapUsuario && overlapUsuario.length > 0) {
            const error = new Error(`El usuario con ID ${entity.id_usuario} ya tiene una reserva activa durante este periodo.`);
            error.statusCode = 400;
            throw error;
        }

        const overlapVehiculo = await this.repo.getOverlapByVehiculoAsync(
            entity.id_vehiculo,
            entity.fecha_entrada,
            entity.fecha_salida,
            excludeId
        );
        if (overlapVehiculo && overlapVehiculo.length > 0) {
            const error = new Error(`El vehiculo con ID ${entity.id_vehiculo} ya tiene una reserva activa durante este periodo.`);
            error.statusCode = 400;
            throw error;
        }

        const garage = await this.garageService.getByIdAsync(entity.id_garage);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 400;
            throw error;
        }

        this._validarGarageDisponible(garage);

        if (garage.dias && garage.dias.length > 0 && entity.dia && !garage.dias.includes(entity.dia)) {
            const error = new Error(`El garage no esta disponible los ${entity.dia}.`);
            error.statusCode = 400;
            throw error;
        }

        if (garage.hora_apertura && garage.hora_cierre) {
            const fechaEntrada = new Date(entity.fecha_entrada);
            const fechaSalida = new Date(entity.fecha_salida);

            const entradaMinutos = fechaEntrada.getHours() * 60 + fechaEntrada.getMinutes();
            const salidaMinutos = fechaSalida.getHours() * 60 + fechaSalida.getMinutes();

            const aperturaParts = garage.hora_apertura.split(':');
            const cierreParts = garage.hora_cierre.split(':');

            const aperturaMinutos = parseInt(aperturaParts[0], 10) * 60 + parseInt(aperturaParts[1], 10);
            const cierreMinutos = parseInt(cierreParts[0], 10) * 60 + parseInt(cierreParts[1], 10);

            if (entradaMinutos < aperturaMinutos) {
                const error = new Error(`El garage abre a las ${garage.hora_apertura.split(':').slice(0, 2).join(':')}.`);
                error.statusCode = 400;
                throw error;
            }

            if (salidaMinutos > cierreMinutos) {
                const error = new Error(`El garage cierra a las ${garage.hora_cierre.split(':').slice(0, 2).join(':')}.`);
                error.statusCode = 400;
                throw error;
            }
        }

        const capReservas = garage.capacidad_reservas !== null && garage.capacidad_reservas !== undefined
            ? garage.capacidad_reservas
            : (garage.capacidad || 0);

        if (capReservas <= 0) {
            const error = new Error(`El garage no tiene capacidad disponible para reservas.`);
            error.statusCode = 400;
            throw error;
        }

        const overlapGarage = await this.repo.getOverlapByGarageAsync(
            entity.id_garage,
            entity.fecha_entrada,
            entity.fecha_salida,
            excludeId
        );

        const events = [
            { time: new Date(entity.fecha_entrada), type: 1 },
            { time: new Date(entity.fecha_salida), type: -1 }
        ];

        for (const reserva of overlapGarage || []) {
            events.push({ time: new Date(reserva.fecha_entrada), type: 1 });
            events.push({ time: new Date(reserva.fecha_salida), type: -1 });
        }

        events.sort((a, b) => {
            const diff = a.time.getTime() - b.time.getTime();
            if (diff !== 0) return diff;
            return a.type - b.type;
        });

        let current = 0;
        let max = 0;
        for (const event of events) {
            current += event.type;
            if (current > max) max = current;
        }

        if (max > capReservas) {
            const error = new Error(`El garage supera su capacidad maxima de reservas (${capReservas}) durante el periodo solicitado.`);
            error.statusCode = 400;
            throw error;
        }
    }

    _validarMaximoReservasDiariasAsync = async (entity, excludeId = null) => {
        const fechaEntrada = new Date(entity.fecha_entrada);
        const year = fechaEntrada.getFullYear();
        const month = String(fechaEntrada.getMonth() + 1).padStart(2, '0');
        const day = String(fechaEntrada.getDate()).padStart(2, '0');
        const fechaStr = `${year}-${month}-${day}`;

        const count = await this.repo.getCountByUsuarioAndDateAsync(entity.id_usuario, fechaStr, excludeId);

        if (count >= 2) {
            const error = new Error('El maximo de reservas en un dia son 2.');
            error.statusCode = 400;
            throw error;
        }
    }

    _validarGarageDisponible = (garage) => {
        if (garage.estado === false) {
            const error = new Error(`El garage no esta disponible.`);
            error.statusCode = 400;
            throw error;
        }

        if (!garage.capacidad || garage.capacidad <= 0) {
            const error = new Error(`El garage no tiene capacidad configurada.`);
            error.statusCode = 400;
            throw error;
        }
    }

    _validarCapacidadTotalActualGarage = (garage) => {
        const totalCap = garage.capacidad || 0;
        const currentNoRes = garage.ocupacion_no_reservas || 0;
        const currentRes = garage.ocupacion_reservas || 0;

        if (currentNoRes + currentRes >= totalCap) {
            const error = new Error(`El garage esta completamente lleno.`);
            error.statusCode = 400;
            throw error;
        }
    }

    _validarCapacidadReservasActualGarage = (garage) => {
        const capReservas = garage.capacidad_reservas !== null && garage.capacidad_reservas !== undefined
            ? garage.capacidad_reservas
            : (garage.capacidad || 0);
        const currentRes = garage.ocupacion_reservas || 0;

        if (currentRes >= capReservas) {
            const error = new Error(`El garage no tiene lugares disponibles para reservas.`);
            error.statusCode = 400;
            throw error;
        }
    }
}

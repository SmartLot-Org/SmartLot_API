// garageService.js
import GarageRepository from '../repositories/garageRepository.js';
import SedeService from './sedeService.js';
import { isValidDiaSemana } from '../helpers/validatorHelper.js';
import pool from '../database/db.js';
import UsuarioGarageService from './usuarioGarageService.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';

export default class GarageService {
    constructor() {
        console.log('Estoy en: GarageService.constructor()');
        this.repo = new GarageRepository();
        this.sedeService = new SedeService();
        this.usuarioGarageService = new UsuarioGarageService();
        this.pool = pool;
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);
    
    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    getByIdForUpdateWithClientAsync = async (id, client) => await this.repo.getByIdForUpdateWithClientAsync(id, client);

    incrementOcupacionReservasWithClientAsync = async (id, client) => await this.repo.incrementOcupacionReservasWithClientAsync(id, client);

    decrementOcupacionReservasWithClientAsync = async (id, client) => await this.repo.decrementOcupacionReservasWithClientAsync(id, client);

    getOcupacionReservaAsync = async (id) => await this.repo.getOcupacionReservaAsync(id);

    getOcupacionNoReservaAsync = async (id) => await this.repo.getOcupacionNoReservaAsync(id);

    createAsync = async (entity, usuario) => {
        await this._validarRelacionesAsync(entity);
        this._validarPrecios(entity);
        this._validarDiasGarage(entity);
        const { id_dueno, id_garagistas = [], ...garageData } = entity;
        const esSuperadmin = hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN);
        const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
        if (!Array.isArray(id_garagistas) || id_garagistas.some(id => !Number.isSafeInteger(id) || id <= 0)) {
            fail('id_garagistas debe ser una lista de IDs enteros positivos.');
        }
        if (id_dueno !== undefined && (!Number.isSafeInteger(id_dueno) || id_dueno <= 0)) {
            fail('id_dueno debe ser un entero positivo.');
        }
        if (!esSuperadmin && (id_dueno !== undefined || id_garagistas.length)) {
            fail('Solo el superadmin puede asignar dueño y garagistas al crear el garage.', 403);
        }
        const ownerId = esSuperadmin ? id_dueno : hasRole(usuario, ROLE_NAMES.DUENO_GARAGE) ? usuario.id : undefined;
        const staffIds = [...new Set(id_garagistas)];
        if (!ownerId && staffIds.length) fail('Selecciona un dueño para asignar garagistas.');
        if (!ownerId) return await this.repo.createAsync(garageData);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            if (esSuperadmin) {
                for (const [id, role] of [[ownerId, ROLE_NAMES.DUENO_GARAGE], ...staffIds.map(id => [id, ROLE_NAMES.GARAGISTA])]) {
                    const result = await client.query(
                        `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.id_rol
                         WHERE u.id = $1 AND lower(trim(r.tipo_rol)) = $2
                         AND COALESCE(u."Borrado", false) = false FOR SHARE OF u, r`, [id, role]);
                    if (!result.rows.length) fail(`El usuario ${id} no existe o no tiene el rol ${role}.`);
                }
            }
            const garage = await this.repo.createWithClientAsync(garageData, client);
            for (const id of [ownerId, ...staffIds]) {
                await this.usuarioGarageService.createWithClientAsync(id, garage.id, client);
            }
            await client.query('COMMIT');
            return garage;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    updateAsync = async (id, entity) => {
        const actual = await this.repo.getByIdAsync(id);
        if (!actual) return null;
        const merged = { ...actual, ...Object.fromEntries(Object.entries(entity).filter(([, value]) => value !== undefined)) };
        await this._validarRelacionesAsync(merged);
        this._validarPrecios(merged);
        if (entity.dias !== undefined) this._validarDiasGarage(merged);
        return await this.repo.updateAsync(id, merged);
    }

    deleteAsync = async (id) => await this.repo.deleteAsync(id);

    restoreAsync = async (id, requestingUser = null) => await this.repo.restoreAsync(id, requestingUser);

    getDiasAsync = async (id_garage) => {
        const garage = await this.repo.getByIdAsync(id_garage);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }
        return await this.repo.getDiasAsync(id_garage);
    }

    addDiaAsync = async (id_garage, dia) => {
        const garage = await this.repo.getByIdAsync(id_garage);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }
        if (!isValidDiaSemana(dia)) {
            const error = new Error(`El dia "${dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`);
            error.statusCode = 400;
            throw error;
        }
        return await this.repo.addDiaAsync(id_garage, dia);
    }

    removeDiaAsync = async (id_garage, dia) => {
        const garage = await this.repo.getByIdAsync(id_garage);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }
        if (!isValidDiaSemana(dia)) {
            const error = new Error(`El dia "${dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`);
            error.statusCode = 400;
            throw error;
        }
        return await this.repo.removeDiaAsync(id_garage, dia);
    }

    registrarIngresoNoReservaAsync = async (id) => {
        const garage = await this.repo.getByIdAsync(id);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }

        const totalCap = garage.capacidad || 0;
        const capNoRes = garage.capacidad_para_no_reservas !== null && garage.capacidad_para_no_reservas !== undefined 
            ? garage.capacidad_para_no_reservas 
            : totalCap;
            
        const currentNoRes = garage.ocupacion_no_reservas || 0;
        const currentRes = garage.ocupacion_reservas || 0;

        if (currentNoRes >= capNoRes) {
            const error = new Error(`Se superó la capacidad máxima para vehículos sin reserva (${capNoRes}).`);
            error.statusCode = 400;
            throw error;
        }

        if (currentNoRes + currentRes >= totalCap) {
            const error = new Error(`El garage está completamente lleno (capacidad total: ${totalCap}).`);
            error.statusCode = 400;
            throw error;
        }

        return await this.repo.incrementOcupacionNoReservasAsync(id);
    }

    registrarEgresoNoReservaAsync = async (id) => {
        const garage = await this.repo.getByIdAsync(id);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }
        return await this.repo.decrementOcupacionNoReservasAsync(id);
    }

    /**
     * Valida las reglas de capacidad.
     * Lanza un error descriptivo si alguna validación falla.
     */
    _validarRelacionesAsync = async (entity) => {
        // Validar reglas de capacidad
        if (entity.capacidad && entity.capacidad_reservas) {
            if (entity.capacidad_reservas > entity.capacidad) {
                const error = new Error('La capacidad de reservas no puede superar la capacidad total.');
                error.statusCode = 400;
                throw error;
            }
        }

        if (entity.capacidad && entity.capacidad_para_no_reservas) {
            if (entity.capacidad_para_no_reservas > entity.capacidad) {
                const error = new Error('La capacidad para no reservas no puede superar la capacidad total.');
                error.statusCode = 400;
                throw error;
            }
        }
    }

    _validarDiasGarage = (entity) => {
        if (!entity.dias || !Array.isArray(entity.dias) || entity.dias.length === 0) {
            const error = new Error('Debe proporcionar al menos un dia disponible para el garage.');
            error.statusCode = 400;
            throw error;
        }

        for (const dia of entity.dias) {
            if (!isValidDiaSemana(dia)) {
                const error = new Error(`El dia "${dia}" no es valido. Use: Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo.`);
                error.statusCode = 400;
                throw error;
            }
        }
    }

    _validarPrecios = (entity) => {
        for (const campo of ['precio_pickup', 'precio_auto', 'precio_moto']) {
            const valor = entity[campo];
            if (valor !== undefined && valor !== null && (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0)) {
                const error = new Error(`${campo} debe ser un numero mayor o igual a 0.`);
                error.statusCode = 400;
                throw error;
            }
        }
    };
}

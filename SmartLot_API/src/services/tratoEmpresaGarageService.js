import TratoEmpresaGarageRepository from '../repositories/tratoEmpresaGarageRepository.js';
import EmpresaService from './empresaService.js';
import GarageService from './garageService.js';
import UsuarioGarageService from './usuarioGarageService.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';

const fail = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
};

export default class TratoEmpresaGarageService {
    constructor() {
        this.repo = new TratoEmpresaGarageRepository();
        this.empresaService = new EmpresaService();
        this.garageService = new GarageService();
        this.usuarioGarageService = new UsuarioGarageService();
    }

    getAllAsync = async (usuario) => {
        const tratos = await this.repo.getAllAsync();
        const permitidos = [];
        for (const trato of tratos) {
            if (await this._canAccessAsync(usuario, trato)) permitidos.push(trato);
        }
        return permitidos;
    };

    getByIdAsync = async (id, usuario) => {
        const trato = await this.repo.getByIdAsync(id);
        if (!trato) fail('El trato no existe.', 404);
        if (!await this._canAccessAsync(usuario, trato)) fail('No tiene acceso a este trato.', 403);
        return trato;
    };

    getByEmpresaAsync = async (idEmpresa, usuario) => {
        const empresa = await this.empresaService.getByIdAsync(idEmpresa);
        if (!empresa) fail('La empresa no existe.', 404);
        const tratos = await this.repo.getByEmpresaAsync(idEmpresa);
        const permitidos = [];
        for (const trato of tratos) {
            if (await this._canAccessAsync(usuario, trato)) permitidos.push(trato);
        }
        if (permitidos.length === 0 && tratos.length > 0) fail('No tiene acceso a los tratos de esta empresa.', 403);
        return permitidos;
    };

    getByGarageAsync = async (idGarage, usuario) => {
        const garage = await this.garageService.getByIdAsync(idGarage);
        if (!garage) fail('El garage no existe.', 404);
        const tratos = await this.repo.getByGarageAsync(idGarage);
        const permitidos = [];
        for (const trato of tratos) {
            if (await this._canAccessAsync(usuario, trato)) permitidos.push(trato);
        }
        if (permitidos.length === 0 && tratos.length > 0) fail('No tiene acceso a los tratos de este garage.', 403);
        if (tratos.length === 0 && hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)
            && !await this.usuarioGarageService.userHasGarageAsync(usuario.id, idGarage)) {
            fail('No tiene acceso a este garage.', 403);
        }
        return permitidos;
    };

    createAsync = async (entity, usuario) => {
        await this._validateAsync(entity);
        if (!await this._canManageAsync(usuario, entity)) fail('No puede crear tratos para este garage o empresa.', 403);
        if (await this.repo.getByEmpresaGarageAsync(entity.id_empresa, entity.id_garage)) {
            fail('Ya existe un trato entre la empresa y el garage indicados.', 409);
        }
        return await this.repo.createAsync(entity);
    };

    updateAsync = async (id, changes, usuario) => {
        const current = await this.repo.getByIdAsync(id);
        if (!current) fail('El trato no existe.', 404);
        if (!await this._canManageAsync(usuario, current)) fail('No puede modificar este trato.', 403);
        const entity = { ...current, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) };
        delete entity.created_at;
        await this._validateAsync(entity);
        if (!await this._canManageAsync(usuario, entity)) fail('No puede mover el trato a otro garage o empresa.', 403);
        if (await this.repo.getByEmpresaGarageAsync(entity.id_empresa, entity.id_garage, id)) {
            fail('Ya existe un trato entre la empresa y el garage indicados.', 409);
        }
        return await this.repo.updateAsync(id, entity);
    };

    deleteAsync = async (id, usuario) => {
        const current = await this.repo.getByIdAsync(id);
        if (!current) fail('El trato no existe.', 404);
        if (!await this._canManageAsync(usuario, current)) fail('No puede eliminar este trato.', 403);
        return await this.repo.deleteAsync(id);
    };

    _validateAsync = async (entity) => {
        if (!Number.isInteger(entity.id_empresa) || entity.id_empresa <= 0) fail('id_empresa debe ser un entero valido.', 400);
        if (!Number.isInteger(entity.id_garage) || entity.id_garage <= 0) fail('id_garage debe ser un entero valido.', 400);
        if (!Number.isInteger(entity.cantidad_cocheras) || entity.cantidad_cocheras <= 0) fail('cantidad_cocheras debe ser un entero mayor que 0.', 400);
        for (const field of ['precio_pickup', 'precio_auto']) {
            if (typeof entity[field] !== 'number' || !Number.isFinite(entity[field]) || entity[field] < 0) {
                fail(`${field} debe ser un numero mayor o igual a 0.`, 400);
            }
        }
        const empresa = await this.empresaService.getByIdAsync(entity.id_empresa);
        if (!empresa) fail('La empresa no existe.', 400);
        const garage = await this.garageService.getByIdAsync(entity.id_garage);
        if (!garage) fail('El garage no existe.', 400);
        if (entity.cantidad_cocheras > Number(garage.capacidad)) {
            fail('cantidad_cocheras no puede superar la capacidad total del garage.', 400);
        }
    };

    _canAccessAsync = async (usuario, trato) => {
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return true;
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) {
            return await this.usuarioGarageService.userHasGarageAsync(usuario.id, trato.id_garage);
        }
        return trato.id_empresa !== null && Number(usuario?.id_empresa) === Number(trato.id_empresa);
    };

    _canManageAsync = async (usuario, trato) => {
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return true;
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) {
            return await this.usuarioGarageService.userHasGarageAsync(usuario.id, trato.id_garage);
        }
        return hasRole(usuario, 1, ROLE_NAMES.ADMIN) && Number(usuario?.id_empresa) === Number(trato.id_empresa);
    };
}

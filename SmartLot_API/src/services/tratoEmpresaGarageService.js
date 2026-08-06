import TratoEmpresaGarageRepository from '../repositories/tratoEmpresaGarageRepository.js';
import GarageService from './garageService.js';
import SedeService from './sedeService.js';
import UsuarioGarageService from './usuarioGarageService.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

export default class TratoEmpresaGarageService {
    constructor() {
        this.repo = new TratoEmpresaGarageRepository();
        this.garageService = new GarageService();
        this.sedeService = new SedeService();
        this.usuarioGarageService = new UsuarioGarageService();
    }

    getAllAsync = async (usuario) => {
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return this.repo.getAllAsync();
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) {
            const all = await this.repo.getAllAsync();
            const result = [];
            for (const row of all) if (await this.usuarioGarageService.userHasGarageAsync(usuario.id, row.id_garage)) result.push(row);
            return result;
        }
        return this.repo.getByEmpresaAsync(Number(usuario.id_empresa), usuario.id_sede ? Number(usuario.id_sede) : null);
    };

    getByIdAsync = async (id, usuario) => {
        const row = await this.repo.getByIdAsync(id);
        if (!row) fail('El trato no existe.', 404);
        if (!await this._canAccessAsync(usuario, row)) fail('No tiene acceso a este trato.', 403);
        return row;
    };
    getByEmpresaAsync = async (idEmpresa, usuario) => {
        if (!hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN) && Number(usuario.id_empresa) !== Number(idEmpresa)) fail('No tiene acceso a esta empresa.', 403);
        return this.repo.getByEmpresaAsync(idEmpresa, usuario.id_sede || null);
    };
    getByGarageAsync = async (idGarage, usuario) => {
        const rows = await this.repo.getByGarageAsync(idGarage);
        const result = [];
        for (const row of rows) if (await this._canAccessAsync(usuario, row)) result.push(row);
        return result;
    };

    createAsync = async (input, usuario) => {
        if (!hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) fail('Los tratos se crean aceptando una solicitud.', 403);
        const idEmpresa = Number(input.id_empresa);
        const idSede = Number(input.id_sede);
        const idGarage = Number(input.id_garage);
        const cantidad = Number(input.cantidad_cocheras);
        if (![idEmpresa, idSede, idGarage, cantidad].every(Number.isInteger) || Math.min(idEmpresa,idSede,idGarage,cantidad) <= 0) fail('Empresa, sede, garage y cantidad deben ser enteros positivos.', 400);
        if (usuario.id_sede && Number(usuario.id_sede) !== idSede) fail('No puede operar con otra sede.', 403);
        const sede = await this.sedeService.getByIdAsync(idSede);
        if (!sede || Number(sede.id_empresa) !== idEmpresa) fail('La sede no pertenece a la empresa autenticada.', 403);
        if (await this.repo.getBySedeGarageAsync(idSede, idGarage)) fail('Ya existe un trato para esa sede y garage.', 409);
        return this.repo.createAgreementAsync({ id_empresa: idEmpresa, id_sede: idSede, id_garage: idGarage, cantidad_cocheras: cantidad });
    };

    updateAsync = async (id, changes, usuario) => {
        const current = await this.getByIdAsync(id, usuario);
        if (!this._adminCanManage(usuario, current)) fail('No puede modificar este trato.', 403);
        const cantidad = Number(changes.cantidad_cocheras);
        if (!Number.isInteger(cantidad) || cantidad <= 0) fail('cantidad_cocheras debe ser un entero mayor que 0.', 400);
        return this.repo.updateQuantityAsync(id, cantidad);
    };
    deleteAsync = async (id, usuario) => {
        const current = await this.getByIdAsync(id, usuario);
        if (!this._adminCanManage(usuario, current)) fail('No puede eliminar este trato.', 403);
        return this.repo.deleteAsync(id);
    };
    _adminCanManage = (usuario, row) => hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN) ||
        (hasRole(usuario, 1, ROLE_NAMES.ADMIN) && Number(usuario.id_empresa) === Number(row.id_empresa) &&
         (!usuario.id_sede || Number(usuario.id_sede) === Number(row.id_sede)));
    _canAccessAsync = async (usuario, row) => {
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return true;
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) return this.usuarioGarageService.userHasGarageAsync(usuario.id, row.id_garage);
        return Number(usuario.id_empresa) === Number(row.id_empresa) && (!usuario.id_sede || Number(usuario.id_sede) === Number(row.id_sede));
    };
}

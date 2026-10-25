// conflictoService.js
import ConflictoRepository from '../repositories/ConflictoRepository.js';
import UsuarioService from './usuarioService.js';
import { isValidMaxWords } from '../helpers/validatorHelper.js';

const MAX_DESCRIPCION_PALABRAS = 300;
const MAX_CONFLICTOS_ACTIVOS_EMPLEADO = 5;

export default class ConflictoService {
    constructor() {
        console.log('Estoy en: ConflictoService.constructor()');
        this.repo = new ConflictoRepository();
        this.usuarioService = new UsuarioService();
    }

    getAllAsync = async (superAdmin = false, requestingUser = null) =>
        await this.repo.getAllAsync(superAdmin, requestingUser);

    getDeletedByUserAsync = async (deletedBy, superAdmin = false, requestingUser = null) =>
        await this.repo.getDeletedByUserAsync(deletedBy, superAdmin, requestingUser);

    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    createAsync = async (entity, requestingUser = null) => {
        await this._validarRelacionesAsync(entity);

        if (!isValidMaxWords(entity.descripcion, MAX_DESCRIPCION_PALABRAS)) {
            const error = new Error(`La descripcion no puede tener mas de ${MAX_DESCRIPCION_PALABRAS} palabras.`);
            error.statusCode = 400;
            throw error;
        }

        const userRole = Number(requestingUser?.id_rol);
        if (userRole === 2) {
            const count = await this.repo.countActiveByUserAsync(entity.id_usuario);
            if (count >=MAX_CONFLICTOS_ACTIVOS_EMPLEADO) {
                const error = new Error(`Ya alcanzaste el limite de ${MAX_CONFLICTOS_ACTIVOS_EMPLEADO} reportes activos. Resolve los pendientes antes de crear uno nuevo.`);
                error.statusCode = 400;
                throw error;
            }
        }

        return await this.repo.createAsync(entity);
    }

    updateAsync = async (id, entity, requestingUser = null) => {
        await this._validarRelacionesAsync(entity);
        await this._validarTenantUsuarioAsync(entity, requestingUser);
        return await this.repo.updateAsync(id, entity, requestingUser);
    }

    deleteAsync = async (id, deletedBy = null, requestingUser = null) =>
        await this.repo.deleteAsync(id, deletedBy, requestingUser);

    restoreAsync = async (id, deletedBy = null, requestingUser = null) =>
        await this.repo.restoreAsync(id, deletedBy, requestingUser);

    _validarRelacionesAsync = async (entity) => {
        if (entity.id_usuario) {
            const usuario = await this.usuarioService.getByIdAsync(entity.id_usuario);
            if (!usuario) {
                const error = new Error(`El usuario con ID ${entity.id_usuario} no existe.`);
                error.statusCode = 400;
                throw error;
            }
        }
    }

    _validarTenantUsuarioAsync = async (entity, requestingUser) => {
        if (!entity.id_usuario || Number(requestingUser?.id_rol) === 4) {
            return;
        }

        const usuario = await this.usuarioService.getByIdAsync(entity.id_usuario);
        if (!usuario) {
            return;
        }

        const requestSede = Number(requestingUser?.id_sede ?? requestingUser?.idSede);
        if (Number.isFinite(requestSede) && requestSede > 0) {
            if (Number(usuario.id_sede ?? usuario.idSede) !== requestSede) {
                const error = new Error('No autorizado: el usuario del conflicto pertenece a otra sede.');
                error.statusCode = 403;
                throw error;
            }
            return;
        }

        const requestEmpresa = Number(requestingUser?.id_empresa ?? requestingUser?.idEmpresa);
        if (Number.isFinite(requestEmpresa) && requestEmpresa > 0) {
            if (Number(usuario.id_empresa ?? usuario.idEmpresa) !== requestEmpresa) {
                const error = new Error('No autorizado: el usuario del conflicto pertenece a otra empresa.');
                error.statusCode = 403;
                throw error;
            }
            return;
        }

        const error = new Error('No autorizado: no se pudo determinar el tenant del usuario solicitante.');
        error.statusCode = 403;
        throw error;
    }
}

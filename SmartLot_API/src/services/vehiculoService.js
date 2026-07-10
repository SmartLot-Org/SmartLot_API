// vehiculoService.js
import VehiculoRepository from '../repositories/vehiculoRepository.js';
import UsuarioService from './usuarioService.js';
import ModeloService from './modeloService.js';

export default class VehiculoService {
    constructor() {
        console.log('Estoy en: VehiculoService.constructor()');
        this.repo = new VehiculoRepository();
        this.usuarioService = new UsuarioService();
        this.modeloService = new ModeloService();
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);
    
    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    createAsync = async (entity, requestingUser) => {
        const rol = Number(requestingUser.id_rol);
        if (rol !== 1 && rol !== 4) {
            entity.id_usuario = requestingUser.id;
        }

        await this._validarRelacionesAsync(entity);

        // Validar patente única
        if (entity.patente) {
            const existing = await this.repo.getByPatenteIncludingDeletedAsync(entity.patente);
            if (existing) {
                if (existing.Borrado) {
                    return await this.repo.reactivateAsync(existing.id, entity);
                }
                const error = new Error(`Ya existe un vehículo con la patente ${entity.patente}.`);
                error.statusCode = 400;
                throw error;
            }
        }

        return await this.repo.createAsync(entity);
    }

    updateAsync = async (id, entity, requestingUser) => {
        const rol = Number(requestingUser.id_rol);
        if (rol !== 1 && rol !== 4) {
            // Verificar que el vehículo pertenezca al usuario que lo modifica (IDOR).
            const current = await this.repo.getByIdAsync(id);
            if (!current) {
                const error = new Error('No encontrado: El vehículo con ese ID no existe.');
                error.statusCode = 404;
                throw error;
            }
            if (Number(current.id_usuario) !== Number(requestingUser.id)) {
                const error = new Error('No tiene permisos para modificar este vehículo.');
                error.statusCode = 403;
                throw error;
            }
            delete entity.id_usuario;
        }

        await this._validarRelacionesAsync(entity);

        // Validar patente única (excluyendo al vehículo actual)
        if (entity.patente) {
            const existing = await this.repo.getByPatenteAsync(entity.patente);
            if (existing && existing.id !== id) {
                const error = new Error(`Ya existe un vehículo con la patente ${entity.patente}.`);
                error.statusCode = 400;
                throw error;
            }
        }

        return await this.repo.updateAsync(id, entity);
    }

    deleteAsync = async (id) => await this.repo.deleteAsync(id);

    /**
     * Valida que las entidades relacionadas (usuario, modelo) existan en la BD.
     * Recopila todos los errores y los lanza juntos.
     */
    _validarRelacionesAsync = async (entity) => {
        const errores = [];

        // Validar que el usuario exista
        if (entity.id_usuario) {
            const usuario = await this.usuarioService.getByIdAsync(entity.id_usuario);
            if (!usuario) {
                errores.push(`El usuario con ID ${entity.id_usuario} no existe.`);
            }
        }

        // Validar que el modelo exista
        if (entity.id_modelo) {
            const modelo = await this.modeloService.getByIdAsync(entity.id_modelo);
            if (!modelo) {
                errores.push(`El modelo con ID ${entity.id_modelo} no existe.`);
            }
        }

        if (errores.length > 0) {
            const error = new Error(errores.join(' '));
            error.statusCode = 400;
            throw error;
        }
    }
}

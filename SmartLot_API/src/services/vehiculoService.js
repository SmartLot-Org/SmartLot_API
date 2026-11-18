// vehiculoService.js
import VehiculoRepository from '../repositories/vehiculoRepository.js';
import UsuarioService from './usuarioService.js';
import ModeloService from './modeloService.js';
import { throwError } from '../helpers/httpError.js';
import { CONFLICT, FORBIDDEN, NOT_FOUND } from '../helpers/httpStatus.js';
import { authorizeWrite } from '../helpers/writeAuthorization.js';

export default class VehiculoService {
    constructor() {
        console.log('Estoy en: VehiculoService.constructor()');
        this.repo = new VehiculoRepository();
        this.usuarioService = new UsuarioService();
        this.modeloService = new ModeloService();
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);
    
    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    // Alcance de escritura (helpers/writeAuthorization): superadmin global, admin solo
    // dentro de su empresa (y de su sede si es admin de sede), empleado solo lo propio.
    createAsync = async (entity, requestingUser) => {
        entity = { ...entity };
        const scope = authorizeWrite(requestingUser, true);
        if (scope.kind === 'own') entity.id_usuario = scope.actorId;
        await this._assertTitularEnAlcanceAsync(entity.id_usuario, scope);

        const { modelo } = await this._validarRelacionesAsync(entity);
        this._asignarTipoVehiculoSegunModelo(entity, modelo);

        // Validar patente única
        if (entity.patente) {
            const existing = await this.repo.getByPatenteIncludingDeletedAsync(entity.patente);
            if (existing) {
                if (existing.Borrado) {
                    return await this.repo.reactivateAsync(existing.id, entity);
                }
                throwError(`Ya existe un vehículo con la patente ${entity.patente}.`, CONFLICT);
            }
        }

        return await this.repo.createAsync(entity);
    }

    updateAsync = async (id, entity, requestingUser) => {
        entity = { ...entity };
        const scope = authorizeWrite(requestingUser, true);
        // Un vehículo fuera del alcance responde igual que uno inexistente: no se revela
        // que existe en otra empresa (antes el admin editaba cualquiera, de cualquier empresa).
        const current = await this.repo.getForWriteAsync(id, scope);
        if (!current) throwError('No encontrado: El vehículo con ese ID no existe.', NOT_FOUND);
        if (scope.kind === 'own') delete entity.id_usuario;
        if (entity.id_usuario !== undefined) await this._assertTitularEnAlcanceAsync(entity.id_usuario, scope);

        // tipo_vehiculo proviene siempre del modelo; nunca se acepta del frontend.
        delete entity.tipo_vehiculo;

        const { modelo } = await this._validarRelacionesAsync(entity);
        // Si cambia el modelo, se recalcula el tipo de vehículo a partir del nuevo modelo.
        if (entity.id_modelo !== undefined) {
            this._asignarTipoVehiculoSegunModelo(entity, modelo);
        }

        // Validar patente única (excluyendo al vehículo actual)
        if (entity.patente) {
            const existing = await this.repo.getByPatenteAsync(entity.patente);
            if (existing && existing.id !== id) {
                throwError(`Ya existe un vehículo con la patente ${entity.patente}.`, CONFLICT);
            }
        }

        return await this.repo.updateAsync(id, entity, scope);
    }

    deleteAsync = async (id, requestingUser) => this.repo.deleteAsync(id, authorizeWrite(requestingUser, true));

    // El titular de un vehículo tiene que estar dentro del alcance de quien escribe:
    // un admin no puede crear ni pasar vehículos a usuarios de otra empresa o sede.
    _assertTitularEnAlcanceAsync = async (idUsuario, scope) => {
        if (!await this.repo.titularEnAlcanceAsync(idUsuario, scope)) {
            throwError('El usuario titular no existe o no pertenece a tu organización.', FORBIDDEN);
        }
    }

    /**
     * Valida que las entidades relacionadas (usuario, modelo) existan en la BD.
     * Recopila todos los errores y los lanza juntos.
     * Devuelve el modelo resuelto para poder derivar su tipo de vehículo.
     */
    _validarRelacionesAsync = async (entity) => {
        const errores = [];
        let modelo = null;

        // Validar que el usuario exista
        if (entity.id_usuario) {
            const usuario = await this.usuarioService.getByIdAsync(entity.id_usuario);
            if (!usuario) {
                errores.push(`El usuario con ID ${entity.id_usuario} no existe.`);
            }
        }

        // Validar que el modelo exista
        if (entity.id_modelo) {
            modelo = await this.modeloService.getByIdAsync(entity.id_modelo);
            if (!modelo) {
                errores.push(`El modelo con ID ${entity.id_modelo} no existe.`);
            }
        }

        if (errores.length > 0) {
            const error = new Error(errores.join(' '));
            error.statusCode = 400;
            throw error;
        }

        return { modelo };
    }

    /**
     * Asigna el tipo de vehículo tomándolo siempre del modelo asociado.
     * Ignora cualquier tipo de vehículo enviado manualmente por el frontend.
     * Si el modelo no tiene un tipo de vehículo, no crea/actualiza el registro.
     */
    _asignarTipoVehiculoSegunModelo = (entity, modelo) => {
        // La fuente de verdad es siempre modelos.tipo_vehiculo.
        delete entity.tipo_vehiculo;

        const tipoVehiculo = modelo?.tipo_vehiculo;
        if (!tipoVehiculo) {
            const error = new Error(`El modelo con ID ${entity.id_modelo} no tiene un tipo de vehículo definido.`);
            error.statusCode = 400;
            throw error;
        }

        entity.tipo_vehiculo = tipoVehiculo;
    }
}

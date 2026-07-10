// sedeService.js
import SedeRepository from '../repositories/sedeRepository.js';
import EmpresaService from './empresaService.js';

export default class SedeService {
    constructor() {
        console.log('Estoy en: SedeService.constructor()');
        this.repo = new SedeRepository();
        this.empresaService = new EmpresaService();
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);
    
    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    createAsync = async (entity) => {
        await this._validarRelacionesAsync(entity);
        return await this.repo.createAsync(entity);
    }

    updateAsync = async (id, entity) => {
        await this._validarRelacionesAsync(entity);
        return await this.repo.updateAsync(id, entity);
    }

    deleteAsync = async (id) => await this.repo.deleteAsync(id);

    /**
     * Valida que las entidades relacionadas (empresa) existan en la BD.
     * Lanza un error descriptivo si alguna no existe.
     */
    _validarRelacionesAsync = async (entity) => {
        if (entity.id_empresa) {
            const empresa = await this.empresaService.getByIdAsync(entity.id_empresa);
            if (!empresa) {
                const error = new Error(`La empresa con ID ${entity.id_empresa} no existe.`);
                error.statusCode = 400;
                throw error;
            }
        }
    }
}

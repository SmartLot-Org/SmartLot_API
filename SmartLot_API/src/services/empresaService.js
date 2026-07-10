// empresaService.js
import EmpresaRepository from '../repositories/empresaRepository.js';

export default class EmpresaService {
    constructor() {
        console.log('Estoy en: EmpresaService.constructor()');
        this.repo = new EmpresaRepository();
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);
    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);
    getAuditAsync = async () => await this.repo.getAuditAsync();
    createAsync = async (entity) => await this.repo.createAsync(entity);
    updateAsync = async (id, entity, requestingUser = null) => await this.repo.updateAsync(id, entity, requestingUser?.id ?? null);
    deleteAsync = async (id, requestingUser = null) => await this.repo.deleteAsync(id, requestingUser?.id ?? null);
}

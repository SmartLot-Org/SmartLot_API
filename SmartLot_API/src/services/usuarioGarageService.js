// usuarioGarageService.js
import UsuarioGarageRepository from '../repositories/usuarioGarageRepository.js';

export default class UsuarioGarageService {
    constructor() {
        console.log('Estoy en: UsuarioGarageService.constructor()');
        this.repo = new UsuarioGarageRepository();
    }

    createWithClientAsync = async (id_usuario, id_garage, client) =>
        await this.repo.createWithClientAsync(id_usuario, id_garage, client);

    getUsuariosByGarageIdAsync = async (id_garage) =>
        await this.repo.getUsuariosByGarageIdAsync(id_garage);

    userHasGarageAsync = async (id_usuario, id_garage) =>
        await this.repo.userHasGarageAsync(id_usuario, id_garage);
}

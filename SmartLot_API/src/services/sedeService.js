// sedeService.js
import SedeRepository from '../repositories/sedeRepository.js';
import pool from '../database/db.js';
import { authorizeWrite, authorizeSiteCompany, writeError } from '../helpers/writeAuthorization.js';

export default class SedeService {
    constructor() {
        console.log('Estoy en: SedeService.constructor()');
        this.repo = new SedeRepository();
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);
    
    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    createAsync = async (entity, actor) => {
        const scope = authorizeWrite(actor);
        const company = entity.id_empresa === undefined && scope.kind === 'company' ? scope.companyId : entity.id_empresa;
        authorizeSiteCompany(scope, company, true);
        return this._writeTransaction(async client => {
            await this.repo.validateCompanyAsync(company, client);
            return this.repo.createAsync({ ...entity, id_empresa: Number(company) }, scope, client);
        });
    }

    updateAsync = async (id, entity, actor) => {
        const scope = authorizeWrite(actor);
        return this._writeTransaction(async client => {
            const current = await this.repo.getForWriteAsync(id, scope, client);
            if (!current) throw writeError('Sede no encontrada.', 404);
            if (entity.id_empresa !== undefined) {
                authorizeSiteCompany(scope, entity.id_empresa);
                await this.repo.validateCompanyAsync(entity.id_empresa, client);
            }
            return this.repo.updateAsync(id, entity, scope, client);
        });
    }

    deleteAsync = async (id, actor) => {
        const scope = authorizeWrite(actor);
        return this._writeTransaction(async client => {
            if (!await this.repo.getForWriteAsync(id, scope, client)) throw writeError('Sede no encontrada.', 404);
            return this.repo.deleteAsync(id, scope, client);
        });
    };

    _writeTransaction = async operation => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }
}

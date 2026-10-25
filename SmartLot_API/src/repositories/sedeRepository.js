// sedeRepository.js
import pool from '../database/db.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';
import { writeTenantFilter } from '../helpers/writeTenantFilter.js';
import { httpError } from '../helpers/httpError.js';

export default class SedeRepository {
    constructor() {
        console.log('Estoy en: SedeRepository.constructor()');
    }

    getAllAsync = async (requestingUser = null) => {
        const tenant = getTenantCondition(requestingUser, 1, { sedeColumn: 'sedes.id', empresaColumn: 'sedes.id_empresa' });
        const result = await pool.query(
            `SELECT * FROM sedes WHERE COALESCE("Borrado", false) = false ${tenant.sql} ORDER BY id`,
            [...tenant.params]
        );
        return result.rows;
    }

    getByIdAsync = async (id, requestingUser = null) => {
        const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 'sedes.id', empresaColumn: 'sedes.id_empresa' });
        const result = await pool.query(
            `SELECT * FROM sedes WHERE id = $1 AND COALESCE("Borrado", false) = false ${tenant.sql}`,
            [id, ...tenant.params]
        );
        return result.rows[0] ?? null;
    }

    validateCompanyAsync = async (id, client) => {
        const company = (await client.query(`SELECT id FROM empresas WHERE id=$1
            AND COALESCE("Borrado",false)=false FOR SHARE`, [id])).rows[0];
        if (!company) throw httpError('La empresa de destino no existe.', 400);
    }

    getForWriteAsync = async (id, scope, client) => {
        const filter = writeTenantFilter(scope, 2, { company: 'sedes.id_empresa', site: 'sedes.id' });
        return (await client.query(`SELECT * FROM sedes WHERE id=$1
            AND COALESCE("Borrado",false)=false ${filter.sql} FOR UPDATE`, [id, ...filter.params])).rows[0] ?? null;
    }

    createAsync = async (entity, scope, client = pool) => {
        if (!scope) throw httpError('Falta alcance autorizado.', 401);
        const filter = writeTenantFilter(scope, 7, { company: 'e.id', site: 'NULL' });
        return (await client.query(`INSERT INTO sedes(id_empresa,nombre,descripcion,ubicacion,latitud,longitud)
            SELECT e.id,$2,$3,$4,$5,$6 FROM empresas e WHERE e.id=$1
            AND COALESCE(e."Borrado",false)=false ${filter.sql} RETURNING *`,
        [entity.id_empresa, entity.nombre, entity.descripcion, entity.ubicacion, entity.latitud ?? null,
            entity.longitud ?? null, ...filter.params])).rows[0];
    }

    updateAsync = async (id, entity, scope, client = pool) => {
        // Solo campos presentes: un PUT parcial no convierte omisiones en NULL.
        const fields = ['id_empresa', 'nombre', 'descripcion', 'ubicacion', 'latitud', 'longitud']
            .filter(field => entity[field] !== undefined);
        if (!fields.length) return this.getForWriteAsync(id, scope, client);
        const params = [id, ...fields.map(field => entity[field])];
        const filter = writeTenantFilter(scope, params.length + 1, { company: 'sedes.id_empresa', site: 'sedes.id' });
        const destination = scope?.kind === 'company' && fields.includes('id_empresa') ? ' AND $2::integer=sedes.id_empresa' : '';
        return (await client.query(`UPDATE sedes SET ${fields.map((field, i) => `${field}=$${i + 2}`).join(',')}
            WHERE id=$1 AND COALESCE("Borrado",false)=false ${filter.sql} ${destination} RETURNING *`,
        [...params, ...filter.params])).rows[0] ?? null;
    }

    deleteAsync = async (id, scope, client = pool) => {
        const filter = writeTenantFilter(scope, 2, { company: 'sedes.id_empresa', site: 'sedes.id' });
        return (await client.query(`UPDATE sedes SET "Borrado"=true
            WHERE id=$1 AND COALESCE("Borrado",false)=false ${filter.sql}`, [id, ...filter.params])).rowCount > 0;
    }
}

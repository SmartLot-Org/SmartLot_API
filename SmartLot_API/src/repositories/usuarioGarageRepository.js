// usuarioGarageRepository.js
import pool from '../database/db.js';
import { getTenantCondition } from '../helpers/tenantFilter.js';

export default class UsuarioGarageRepository {
    constructor() {
        console.log('Estoy en: UsuarioGarageRepository.constructor()');
    }

    createWithClientAsync = async (id_usuario, id_garage, client) => {
        // En una transacción, no hacemos try/catch interno para que los errores
        // se propaguen y provoquen el ROLLBACK en la transacción.
        const result = await client.query(
            `INSERT INTO usuario_garage (id_usuario, id_garage) 
             VALUES ($1, $2) RETURNING *`,
            [id_usuario, id_garage]
        );
        return result.rows[0];
    }

    getUsuariosByGarageIdAsync = async (id_garage, requestingUser = null) => {
        try {
            const tenant = getTenantCondition(requestingUser, 2, { sedeColumn: 's.id', empresaColumn: 's.id_empresa' });
            const result = await pool.query(
                `SELECT u.* 
                 FROM usuarios u
                 INNER JOIN usuario_garage ug ON u.id = ug.id_usuario
                 INNER JOIN garages g ON g.id = ug.id_garage
                 INNER JOIN sedes s ON s.id = g.id_sede
                 WHERE ug.id_garage = $1 ${tenant.sql}`,
                [id_garage, ...tenant.params]
            );
            return result.rows;
        } catch (error) {
            console.error(error);
            return null;
        }
    }

    userHasGarageAsync = async (id_usuario, id_garage) => {
        const result = await pool.query(
            'SELECT 1 FROM usuario_garage WHERE id_usuario = $1 AND id_garage = $2 LIMIT 1',
            [id_usuario, id_garage]
        );
        return result.rowCount > 0;
    };
}

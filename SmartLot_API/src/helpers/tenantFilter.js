// helpers/tenantFilter.js
//
// Utilidad compartida para aplicar aislamiento multi-tenant en las consultas SQL.
// Sigue la misma filosofía que `ConflictoRepository.getTenantCondition`, pero admite
// que la columna de sede y de empresa provengan de tablas distintas (p. ej. garages
// tiene `id_sede` y su sede relacionada tiene `id_empresa`).
//
// Reglas:
//   - Superadmin (rol 4): ve todos los tenants (condición vacía).
//   - Dueño de garage o garagista (sin id_empresa/id_sede): solo ve datos de los
//     garages que tiene asignados en `usuario_garage` (requiere `garageColumn`).
//   - Usuario con `id_sede`: solo ve datos de su sede (sedeColumn).
//   - Usuario con `id_empresa`: solo ve datos de su empresa (empresaColumn).
//   - Usuario sin contexto de tenant: no ve nada (`AND false`).
//
// Uso:
//   const tenant = getTenantCondition(req.usuario, 1, { sedeColumn: 'u.id_sede', empresaColumn: 'u.id_empresa' });
//   const result = await pool.query(
//     `SELECT * FROM tabla t WHERE COALESCE(t."Borrado", false) = false ${tenant.sql}`,
//     [...tenant.params]
//   );

import { hasRole, ROLE_IDS } from './roles.js';

const isPositiveNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
};

/**
 * Devuelve un fragmento SQL `AND` y sus parámetros para restringir el resultado
 * al tenant del usuario que hace la petición.
 *
 * @param {object|null} requestingUser - `req.usuario` (debe contener id_rol, id_empresa, id_sede).
 * @param {number} firstParamIndex - Índice `$N` del primer parámetro a agregar.
 * @param {{ sedeColumn: string, empresaColumn: string, garageColumn?: string, ownerColumn?: string }} columns -
 *        Referencias SQL completas (con alias). Siempre constantes del repositorio, nunca datos
 *        del pedido. `ownerColumn` restringe al empleado (rol 2) a sus propios registros.
 * @returns {{ sql: string, params: any[] }}
 */
export const getTenantCondition = (requestingUser, firstParamIndex, columns) => {
    // Sin usuario solicitante (validaciones internas de servicios): no se aplica
    // filtro de tenant, preservando el comportamiento previo a este cambio.
    if (!requestingUser) {
        return { sql: '', params: [] };
    }

    if (hasRole(requestingUser, ROLE_IDS.SUPERADMIN)) {
        return { sql: '', params: [] };
    }

    // Por ID de rol, no por nombre (ver helpers/roles.js).
    const esRolDeGarage = hasRole(requestingUser, ROLE_IDS.DUENO_GARAGE, ROLE_IDS.GARAGISTA);
    if (esRolDeGarage && columns.garageColumn) {
        return {
            sql: ` AND EXISTS (SELECT 1 FROM usuario_garage tenant_ug WHERE tenant_ug.id_usuario = $${firstParamIndex} AND tenant_ug.id_garage = ${columns.garageColumn})`,
            params: [Number(requestingUser.id)],
        };
    }

    // Un empleado no ve las reservas ni los vehículos de sus compañeros de sede:
    // es el mismo alcance "own" que ya aplican las escrituras (authorizeWrite).
    if (hasRole(requestingUser, ROLE_IDS.CLIENTE) && columns.ownerColumn) {
        if (!isPositiveNumber(requestingUser.id)) return { sql: ' AND false', params: [] };
        return {
            sql: ` AND ${columns.ownerColumn} = $${firstParamIndex}`,
            params: [Number(requestingUser.id)],
        };
    }

    const idSede = requestingUser?.id_sede;
    if (isPositiveNumber(idSede)) {
        return {
            sql: ` AND ${columns.sedeColumn} = $${firstParamIndex}`,
            params: [Number(idSede)],
        };
    }

    const idEmpresa = requestingUser?.id_empresa;
    if (isPositiveNumber(idEmpresa)) {
        return {
            sql: ` AND ${columns.empresaColumn} = $${firstParamIndex}`,
            params: [Number(idEmpresa)],
        };
    }

    return { sql: ' AND false', params: [] };
};

export default getTenantCondition;

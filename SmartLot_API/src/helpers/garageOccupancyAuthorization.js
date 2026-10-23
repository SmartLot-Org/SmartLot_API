// Operacion de ocupacion global: es mas restrictiva que la lectura comercial.
// El actor proviene del middleware; id_garage/id_garages del payload no autorizan.
import { writeError } from './writeAuthorization.js';

const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
export function isGarageOccupancyScope(scope) {
    if (!scope || !validId(scope.actorId)) return false;
    return (scope.kind === 'global' && scope.roleId === 4) ||
        (scope.kind === 'assigned' && scope.roleId === 3) ||
        (scope.kind === 'owned' && scope.roleId === 1 && validId(scope.companyId) &&
            (scope.siteId == null || validId(scope.siteId)));
}

export function authorizeGarageOccupancy(actor) {
    if (!actor || !validId(actor.id)) throw writeError('No autenticado.', 401);
    const base = { actorId: Number(actor.id), roleId: Number(actor.id_rol) };
    if (base.roleId === 4) return Object.freeze({ ...base, kind: 'global' });
    if (base.roleId === 3) return Object.freeze({ ...base, kind: 'assigned' });
    if (base.roleId === 1 && validId(actor.id_empresa) &&
        (actor.id_sede == null || validId(actor.id_sede))) {
        return Object.freeze({ ...base, kind: 'owned', companyId: Number(actor.id_empresa),
            siteId: actor.id_sede == null ? null : Number(actor.id_sede) });
    }
    throw writeError('No tiene permisos para operar la ocupacion del garage.', 403);
}

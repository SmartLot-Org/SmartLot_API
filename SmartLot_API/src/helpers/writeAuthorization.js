import { httpError } from './httpError.js';
// Decisiones de permisos para las escrituras de SEG-04. El actor proviene
// exclusivamente del middleware; nunca se mezcla con el payload del recurso.
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function authorizeWrite(actor, reservations = false) {
    if (!actor || !positiveId(actor.id)) throw httpError('No autenticado.', 401);
    const role = Number(actor.id_rol);
    if (role === 4) return Object.freeze({ kind: 'global', actorId: Number(actor.id) });
    if (reservations && role === 2) return Object.freeze({ kind: 'own', actorId: Number(actor.id) });
    if (role !== 1 || !positiveId(actor.id_empresa) ||
        (actor.id_sede != null && !positiveId(actor.id_sede))) {
        throw httpError('No tiene permisos para realizar esta accion.', 403);
    }
    return Object.freeze({ kind: 'company', actorId: Number(actor.id),
        companyId: Number(actor.id_empresa), siteId: actor.id_sede == null ? null : Number(actor.id_sede) });
}

// La edicion propia sigue permitida para los roles del controller de usuarios;
// no se reutiliza la politica exclusiva de administracion de estado/baja.
export function authorizeUserEdit(actor, targetId) {
    if (!actor || !positiveId(actor.id)) throw httpError('No autenticado.', 401);
    if (Number(actor.id_rol) === 4) return authorizeWrite(actor);
    if (Number(actor.id) === Number(targetId) &&
        ([1, 2, 3, 5].includes(Number(actor.id_rol)) || actor.tipo_rol === 'dueño_garage')) {
        return Object.freeze({ kind: 'own', actorId: Number(actor.id) });
    }
    return authorizeWrite(actor);
}

export function authorizeUserEditDestination(scope, entity, site) {
    if (!site) return;
    if (scope.kind === 'company' && (Number(site.id_empresa) !== scope.companyId ||
        (scope.siteId != null && Number(site.id) !== scope.siteId))) {
        throw httpError('La sede de destino no esta autorizada.', 403);
    }
    if (entity.id_empresa != null && Number(site.id_empresa) !== Number(entity.id_empresa)) {
        throw httpError('La sede no pertenece a la empresa indicada.', 400);
    }
}

export function authorizeUserLifecycle(scope, target) {
    if (scope.kind !== 'global' && (Number(target.id_rol) === 4 ||
        String(target.tipo_rol).trim().toLowerCase() === 'superadmin')) {
        throw httpError('No puede desactivar, reactivar ni eliminar un superadmin.', 403);
    }
}

export function authorizeSiteCompany(scope, company, creating = false) {
    if (creating && scope.kind === 'company' && scope.siteId != null) {
        throw httpError('Un administrador de sede no puede crear otras sedes.', 403);
    }
    if (!positiveId(company)) throw httpError('Debe indicar una empresa valida.', 400);
    if (scope.kind === 'company' && Number(company) !== scope.companyId) {
        throw httpError('No puede crear ni transferir sedes a otra empresa.', 403);
    }
}

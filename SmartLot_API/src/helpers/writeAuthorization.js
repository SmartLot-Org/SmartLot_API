// Decisiones de permisos para las escrituras de SEG-04. El actor proviene
// exclusivamente del middleware; nunca se mezcla con el payload del recurso.
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
export const writeError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

export function authorizeWrite(actor, reservations = false) {
    if (!actor || !positiveId(actor.id)) throw writeError('No autenticado.', 401);
    const role = Number(actor.id_rol);
    if (role === 4) return Object.freeze({ kind: 'global', actorId: Number(actor.id) });
    if (reservations && role === 2) return Object.freeze({ kind: 'own', actorId: Number(actor.id) });
    if (role !== 1 || !positiveId(actor.id_empresa) ||
        (actor.id_sede != null && !positiveId(actor.id_sede))) {
        throw writeError('No tiene permisos para realizar esta accion.', 403);
    }
    return Object.freeze({ kind: 'company', actorId: Number(actor.id),
        companyId: Number(actor.id_empresa), siteId: actor.id_sede == null ? null : Number(actor.id_sede) });
}

export function authorizeUserLifecycle(scope, target) {
    if (scope.kind !== 'global' && (Number(target.id_rol) === 4 ||
        String(target.tipo_rol).trim().toLowerCase() === 'superadmin')) {
        throw writeError('No puede desactivar, reactivar ni eliminar un superadmin.', 403);
    }
}

export function authorizeSiteCompany(scope, company, creating = false) {
    if (creating && scope.kind === 'company' && scope.siteId != null) {
        throw writeError('Un administrador de sede no puede crear otras sedes.', 403);
    }
    if (!positiveId(company)) throw writeError('Debe indicar una empresa valida.', 400);
    if (scope.kind === 'company' && Number(company) !== scope.companyId) {
        throw writeError('No puede crear ni transferir sedes a otra empresa.', 403);
    }
}

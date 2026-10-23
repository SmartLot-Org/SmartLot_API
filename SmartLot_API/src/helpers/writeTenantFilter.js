// Traduccion SQL de un alcance previamente autorizado. Las columnas provienen
// de constantes del repositorio, nunca de datos enviados por el cliente.
export function writeTenantFilter(scope, first, columns) {
    if (scope?.kind === 'global') return { sql: '', params: [] };
    if (scope?.kind === 'own' && columns.owner) {
        return { sql: ` AND ${columns.owner}=$${first}`, params: [scope.actorId] };
    }
    if (scope?.kind === 'company') {
        return {
            sql: ` AND ${columns.company}=$${first}` +
                (scope.siteId == null ? '' : ` AND ${columns.site}=$${first + 1}`),
            params: scope.siteId == null ? [scope.companyId] : [scope.companyId, scope.siteId]
        };
    }
    // Un llamado interno sin alcance explicito tampoco habilita escrituras.
    return { sql: ' AND false', params: [] };
}

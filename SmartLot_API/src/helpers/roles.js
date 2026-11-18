// Roles de SmartLot. La fuente de verdad son los IDs fijos de docs/roles.sql
// (1 admin, 2 empleado, 3 garagista, 4 smartlot, 5 dueño_garage).
//
// Los nombres que usa el código son alias de esos IDs: hasRole nunca compara
// contra roles.tipo_rol. Antes "superadmin" y "cliente" no coincidían con lo que
// guarda la base ("smartlot" y "empleado"), así que esas ramas nunca se cumplían;
// y como tipo_rol no es UNIQUE, un rol nuevo llamado "admin" habría heredado los
// permisos del rol 1. Autorizar por ID cierra las dos cosas.
export const ROLE_IDS = Object.freeze({
    ADMIN: 1,
    CLIENTE: 2,
    GARAGISTA: 3,
    SUPERADMIN: 4,
    DUENO_GARAGE: 5,
});

export const ROLE_NAMES = Object.freeze({
    ADMIN: 'admin',
    CLIENTE: 'cliente',
    GARAGISTA: 'garagista',
    DUENO_GARAGE: 'dueño_garage',
    SUPERADMIN: 'superadmin',
});

export const normalizeRoleName = (value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

// Nombre (del código o de la base) → ID canónico.
const ROLE_ALIASES = Object.freeze({
    admin: ROLE_IDS.ADMIN,
    cliente: ROLE_IDS.CLIENTE,
    empleado: ROLE_IDS.CLIENTE,
    garagista: ROLE_IDS.GARAGISTA,
    superadmin: ROLE_IDS.SUPERADMIN,
    smartlot: ROLE_IDS.SUPERADMIN,
    'dueño_garage': ROLE_IDS.DUENO_GARAGE,
    'dueno_garage': ROLE_IDS.DUENO_GARAGE,
});

export const roleIdOf = (role) => (typeof role === 'number' ? role : ROLE_ALIASES[normalizeRoleName(role)]);

export const hasRole = (usuario, ...roles) => {
    const id = Number(usuario?.id_rol);
    if (!Number.isInteger(id)) return false;
    return roles.some((role) => roleIdOf(role) === id);
};

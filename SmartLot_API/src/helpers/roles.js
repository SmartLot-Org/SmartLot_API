export const ROLE_NAMES = Object.freeze({
    ADMIN: 'admin',
    CLIENTE: 'cliente',
    GARAGISTA: 'garagista',
    DUENO_GARAGE: 'dueño_garage',
    SUPERADMIN: 'superadmin',
});

export const normalizeRoleName = (value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

export const hasRole = (usuario, ...roles) => {
    const id = Number(usuario?.id_rol);
    const nombre = normalizeRoleName(usuario?.tipo_rol);
    return roles.some((role) => (
        typeof role === 'number' ? id === role : nombre === normalizeRoleName(role)
    ));
};

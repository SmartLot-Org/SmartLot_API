export const ESTADOS_SOLICITUD = Object.freeze({
    PENDIENTE: 'pendiente',
    ACEPTADA: 'aceptada',
    RECHAZADA: 'rechazada',
    CANCELADA: 'cancelada',
});

export const TRANSICIONES_SOLICITUD = Object.freeze({
    [ESTADOS_SOLICITUD.PENDIENTE]: Object.freeze([
        ESTADOS_SOLICITUD.ACEPTADA,
        ESTADOS_SOLICITUD.RECHAZADA,
        ESTADOS_SOLICITUD.CANCELADA,
    ]),
});

export const puedeTransicionarSolicitud = (desde, hacia) =>
    TRANSICIONES_SOLICITUD[desde]?.includes(hacia) === true;

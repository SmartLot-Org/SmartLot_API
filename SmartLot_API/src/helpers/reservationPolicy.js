// fecha_salida es hora local argentina; retencion_pago_hasta es timestamptz.
export const ACTIVE_RESERVATION_SQL = `"Borrado" = false
    AND estado_reserva IN ('pendiente_pago', 'confirmada')
    AND ((estado_reserva = 'pendiente_pago' AND retencion_pago_hasta > NOW())
      OR (estado_reserva = 'confirmada' AND salio = false
          AND (fecha_salida >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')
               OR entro = true)))`;

export const validateReservationLimit = (value) => {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 32767)) {
        throw Object.assign(new Error('limiteReservasActivas debe ser null o un entero entre 0 y 32767.'), { statusCode: 400 });
    }
    return value;
};

export const reservationPolicy = (limit, current) => ({
    sinLimite: limit == null,
    limite: limit ?? null,
    activas: current,
    restantes: limit == null ? null : Math.max(0, limit - current),
});

export const enforceReservationLimit = (limit, current) => {
    if (limit != null && current >= limit) {
        throw Object.assign(new Error(`Alcanzaste el límite de ${limit} reservas activas definido por tu empresa.`), {
            statusCode: 409,
            code: 'RESERVATION_LIMIT_REACHED',
            details: { limit, current },
        });
    }
};

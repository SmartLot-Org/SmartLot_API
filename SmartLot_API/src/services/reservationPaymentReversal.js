import { readProviderRefundState } from './paymentRefundState.js';

// Un pago de reserva aprobado confirma la reserva (paymentController). La regla
// inversa faltaba: después de un reembolso total o de un contracargo la reserva
// seguía confirmada, con su QR vigente, y el empleado estacionaba sin haber pagado.

// Reversión total confirmada por Mercado Pago. Un reembolso parcial es una
// compensación que decide el superadmin y no anula la reserva.
export function isTotalReversal(payment) {
    if (payment?.status === 'charged_back') return true;
    const state = readProviderRefundState(payment);
    return payment?.status === 'refunded' || (state.known && state.valid && state.classification === 'total');
}

// Cancela la reserva si todavía no se usó. Si el vehículo ya entró, la estadía
// existe y queda para regularizar: no se borra un ingreso real.
export async function releaseReservationAfterReversal(db, idReserva) {
    const id = Number(idReserva);
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    const result = await db.query(
        `UPDATE reservas
            SET estado_reserva = 'cancelada', "Borrado" = true, retencion_pago_hasta = NULL
          WHERE id = $1 AND responsable_pago = 'empleado' AND estado_reserva = 'confirmada'
            AND COALESCE(entro, false) = false AND COALESCE("Borrado", false) = false
          RETURNING id`,
        [id]
    );
    return result.rowCount > 0;
}

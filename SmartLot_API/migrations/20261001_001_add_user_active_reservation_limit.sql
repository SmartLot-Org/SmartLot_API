-- Documenta la migración remota 20261001123359_add_user_active_reservation_limit.
-- Reproducible e idempotente. No modifica límites ni reservas existentes.
BEGIN;
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS limite_reservas_activas smallint NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.usuarios'::regclass
          AND conname = 'usuarios_limite_reservas_activas_no_negativo'
    ) THEN
        ALTER TABLE public.usuarios
            ADD CONSTRAINT usuarios_limite_reservas_activas_no_negativo
            CHECK (limite_reservas_activas IS NULL OR limite_reservas_activas >= 0);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_reservas_usuario_vigentes
    ON public.reservas (id_usuario, estado_reserva, fecha_salida, retencion_pago_hasta)
    WHERE "Borrado" = false AND estado_reserva IN ('pendiente_pago', 'confirmada');
COMMIT;

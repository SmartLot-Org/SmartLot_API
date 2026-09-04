-- Corrige la vinculación del pago semilla de agosto que fue creado por la
-- versión anterior de 20260904_002. No toca pagos reales de Mercado Pago.

BEGIN;

-- Busca el consumo del fixture por sus datos, porque el ID puede variar entre
-- bases. El ORDER BY toma el último registro si la migración fue ejecutada más
-- de una vez antes de quedar idempotente.
WITH consumo_objetivo AS (
    SELECT c.id, c.id_reserva, c.id_empresa
    FROM consumos_reserva c
    WHERE c.id_empresa = (
        SELECT p.id_empresa
        FROM pagos p
        WHERE p.id_orden_externa = 'ADMIN-PAGO-2026-08-G29-S4-SEED-20260904'
          AND p.mp_payment_id = 'TEST-MP-SEED-20260904-G29-2026-08'
        LIMIT 1
    )
      AND c.id_garage = 29
      AND c.id_sede = 4
      AND to_char(c.fecha_inicio, 'YYYY-MM') = '2026-08'
    ORDER BY c.id DESC
    LIMIT 1
)
UPDATE pagos p
SET id_reserva = c.id_reserva,
    metadata = COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
        'consumos_ids', jsonb_build_array(c.id),
        'reservas_ids', jsonb_build_array(c.id_reserva),
        'periodo', '2026-08',
        'id_garage', 29,
        'id_sede', 4
    ),
    fecha_actualizacion = NOW()
FROM consumo_objetivo c
WHERE p.id_orden_externa = 'ADMIN-PAGO-2026-08-G29-S4-SEED-20260904'
  AND p.mp_payment_id = 'TEST-MP-SEED-20260904-G29-2026-08'
  AND p.id_empresa = c.id_empresa;

COMMIT;

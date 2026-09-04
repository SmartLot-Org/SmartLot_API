-- Corrige la vinculación del pago semilla de agosto que fue creado por la
-- versión anterior de 20260904_002. No toca pagos reales de Mercado Pago.

BEGIN;

UPDATE pagos
SET id_reserva = 232,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'consumos_ids', jsonb_build_array(81),
        'reservas_ids', jsonb_build_array(232),
        'periodo', '2026-08',
        'id_garage', 29,
        'id_sede', 4
    ),
    fecha_actualizacion = NOW()
WHERE id_orden_externa = 'ADMIN-PAGO-2026-08-G29-S4-SEED-20260904'
  AND mp_payment_id = 'TEST-MP-SEED-20260904-G29-2026-08'
  AND id_empresa = 5
  AND EXISTS (
      SELECT 1
      FROM consumos_reserva c
      WHERE c.id = 81
        AND c.id_reserva = 232
        AND c.id_empresa = 5
        AND c.id_garage = 29
        AND c.id_sede = 4
  );

COMMIT;

BEGIN;

ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS qr_salida_token uuid;

-- Reservas que ya ingresaron antes del despliegue necesitan un QR de salida.
UPDATE reservas
SET qr_salida_token = gen_random_uuid()
WHERE COALESCE(entro, false) = true
  AND COALESCE(salio, false) = false
  AND COALESCE("Borrado", false) = false
  AND estado_reserva = 'confirmada'
  AND qr_salida_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reservas_qr_salida_token
    ON reservas (qr_salida_token)
    WHERE qr_salida_token IS NOT NULL;

ALTER TABLE reservas
    ADD CONSTRAINT reservas_qr_salida_distinto_chk
    CHECK (qr_salida_token IS NULL OR qr_salida_token <> qr_token);

COMMIT;

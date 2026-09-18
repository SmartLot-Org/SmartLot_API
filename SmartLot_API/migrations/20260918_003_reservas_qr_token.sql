BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS qr_token uuid;

UPDATE reservas
SET qr_token = gen_random_uuid()
WHERE qr_token IS NULL;

ALTER TABLE reservas
    ALTER COLUMN qr_token SET DEFAULT gen_random_uuid(),
    ALTER COLUMN qr_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reservas_qr_token
    ON reservas (qr_token);

COMMIT;

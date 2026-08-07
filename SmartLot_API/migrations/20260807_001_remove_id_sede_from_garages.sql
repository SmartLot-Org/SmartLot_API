BEGIN;

ALTER TABLE garages
    DROP CONSTRAINT IF EXISTS garages_id_sede_fkey;

ALTER TABLE garages
    DROP COLUMN IF EXISTS id_sede;

COMMIT;

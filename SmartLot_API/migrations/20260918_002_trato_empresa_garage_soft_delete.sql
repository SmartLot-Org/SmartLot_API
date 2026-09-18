-- Soft delete para trato_empresa_garage: los tratos con consumos_reserva
-- asociados no pueden eliminarse físicamente (FK consumos_reserva_id_trato_fkey).
-- Se agrega "Borrado" (mismo patrón que garages) y el índice único sede+garage
-- pasa a ser parcial para permitir recrear un trato tras cancelarlo.

BEGIN;

ALTER TABLE trato_empresa_garage
  ADD COLUMN IF NOT EXISTS "Borrado" boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS uq_trato_sede_garage;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trato_sede_garage
  ON trato_empresa_garage (id_sede, id_garage)
  WHERE id_sede IS NOT NULL AND "Borrado" = false;

CREATE INDEX IF NOT EXISTS idx_trato_empresa_garage_activos
  ON trato_empresa_garage (id_garage)
  WHERE "Borrado" = false;

COMMIT;

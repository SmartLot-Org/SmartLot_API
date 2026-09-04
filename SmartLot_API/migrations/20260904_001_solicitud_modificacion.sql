BEGIN;

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS tipo_solicitud TEXT NOT NULL DEFAULT 'nueva';

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS id_trato INTEGER NULLABLE REFERENCES trato_empresa_garage(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_modificacion_pendiente
  ON solicitudes (id_trato)
  WHERE tipo_solicitud = 'modificacion' AND estado = 'pendiente';

COMMIT;

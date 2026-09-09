BEGIN;

CREATE TABLE IF NOT EXISTS solicitudes_registro (
  id serial PRIMARY KEY,
  nombre text NOT NULL,
  apellido text NOT NULL,
  email text NOT NULL,
  telefono text,
  contraseña_hash text NOT NULL,
  empresa_nombre text NOT NULL,
  empresa_descripcion text,
  estado text NOT NULL DEFAULT 'pendiente',
  created_at timestamptz NOT NULL DEFAULT now(),
  revisada_at timestamptz,
  revisada_por integer REFERENCES usuarios(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitudes_registro_email_pendiente
  ON solicitudes_registro (email)
  WHERE estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_solicitudes_registro_estado
  ON solicitudes_registro (estado, created_at DESC);

COMMIT;

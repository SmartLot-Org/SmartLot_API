BEGIN;

CREATE TABLE IF NOT EXISTS notificaciones (
  id serial PRIMARY KEY,
  id_usuario integer NOT NULL REFERENCES usuarios(id),
  id_garage integer REFERENCES garages(id),
  tipo text NOT NULL,
  mensaje text NOT NULL,
  actor_nombre text,
  id_relacion integer,
  leida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario
  ON notificaciones (id_usuario, leida, created_at DESC);

COMMIT;
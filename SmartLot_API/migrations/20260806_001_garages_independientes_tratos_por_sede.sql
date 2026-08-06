BEGIN;

-- El vínculo histórico se conserva, pero deja de ser obligatorio o fuente de propiedad.
ALTER TABLE garages ALTER COLUMN id_sede DROP NOT NULL;

ALTER TABLE trato_empresa_garage ADD COLUMN IF NOT EXISTS id_sede integer;

-- Backfill seguro únicamente cuando la sede histórica coincide con la empresa del trato.
UPDATE trato_empresa_garage t
SET id_sede = g.id_sede
FROM garages g
JOIN sedes s ON s.id = g.id_sede
WHERE t.id_garage = g.id
  AND t.id_sede IS NULL
  AND s.id_empresa = t.id_empresa;

-- NOT VALID conserva cualquier dato legacy inconsistente; sí controla escrituras nuevas.
DO $$ BEGIN
  ALTER TABLE trato_empresa_garage
    ADD CONSTRAINT trato_empresa_garage_id_sede_fkey
    FOREIGN KEY (id_sede) REFERENCES sedes(id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trato_sede_garage
  ON trato_empresa_garage (id_sede, id_garage)
  WHERE id_sede IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trato_empresa_sede
  ON trato_empresa_garage (id_empresa, id_sede);
CREATE INDEX IF NOT EXISTS idx_trato_garage
  ON trato_empresa_garage (id_garage);
CREATE INDEX IF NOT EXISTS idx_usuario_garage_usuario
  ON usuario_garage (id_usuario, id_garage);

COMMIT;

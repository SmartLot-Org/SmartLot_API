BEGIN;

-- Garage propio de la empresa en una sede: marca de propiedad/exclusividad.
-- Distingue del id_sede historico (eliminado en 20260807_001): este campo
-- marca garages que pertenecen a una sede y no se ofrecen a otras empresas.
ALTER TABLE garages
    ADD COLUMN IF NOT EXISTS id_sede_propia integer
    REFERENCES sedes(id);

-- Un unico garage propio activo por sede; el parcial permite recrear
-- despues de un soft-delete.
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_propio_sede
    ON garages (id_sede_propia)
    WHERE id_sede_propia IS NOT NULL AND COALESCE("Borrado", false) = false;

COMMIT;

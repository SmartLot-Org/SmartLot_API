-- Regla de negocio: los usuarios con rol `garagista` no dependen de una empresa
-- ni de una sede. Su relacion con los garages vive exclusivamente en
-- `usuario_garage`.
--
-- Esta migracion:
--   1. Garantiza que `usuarios.id_sede` e `usuarios.id_empresa` acepten NULL
--      (solo quita NOT NULL si existe; si ya son nullables no hace cambios).
--   2. Corrige unicamente las filas cuyo rol es garagista y tengan valores.
--   3. No modifica empleados, administradores, superadmins ni dueños de garage.
--   4. No elimina ni modifica filas de `usuario_garage`.
--
-- Es idempotente: puede ejecutarse mas de una vez sin efectos adicionales.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuarios'
      AND column_name = 'id_sede'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE usuarios ALTER COLUMN id_sede DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuarios'
      AND column_name = 'id_empresa'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE usuarios ALTER COLUMN id_empresa DROP NOT NULL;
  END IF;
END $$;

UPDATE usuarios
   SET id_sede = NULL,
       id_empresa = NULL
 WHERE (
        id_rol = 3
        OR id_rol IN (
          SELECT id FROM roles WHERE lower(trim(tipo_rol)) = 'garagista'
        )
       )
   AND (id_sede IS NOT NULL OR id_empresa IS NOT NULL);

-- Falla de forma explicita si algun garagista quedo con tenant asignado.
DO $$
DECLARE pendientes integer;
BEGIN
  SELECT COUNT(*) INTO pendientes
    FROM usuarios
   WHERE (
          id_rol = 3
          OR id_rol IN (
            SELECT id FROM roles WHERE lower(trim(tipo_rol)) = 'garagista'
          )
         )
     AND (id_sede IS NOT NULL OR id_empresa IS NOT NULL);

  IF pendientes > 0 THEN
    RAISE EXCEPTION 'Quedaron % usuarios garagista con id_sede o id_empresa asignados.', pendientes;
  END IF;
END $$;

COMMIT;

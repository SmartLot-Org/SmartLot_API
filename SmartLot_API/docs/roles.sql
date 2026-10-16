-- Roles de aplicación leídos de Supabase. No son roles LOGIN de PostgreSQL.
BEGIN;
INSERT INTO public.roles (id, tipo_rol, "Borrado") VALUES
    (1, 'admin', false),
    (2, 'empleado', false),
    (3, 'garagista', false),
    (4, 'smartlot', false),
    (5, 'dueño_garage', false)
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM (VALUES
            (1, 'admin'), (2, 'empleado'), (3, 'garagista'),
            (4, 'smartlot'), (5, 'dueño_garage')
        ) AS esperado(id, tipo_rol)
        JOIN public.roles r USING (id)
        WHERE r.tipo_rol IS DISTINCT FROM esperado.tipo_rol OR r."Borrado"
    ) THEN
        RAISE EXCEPTION 'Los roles existentes no coinciden con los IDs y nombres esperados';
    END IF;
END $$;
SELECT setval(pg_get_serial_sequence('public.roles', 'id'),
    GREATEST((SELECT MAX(id) FROM public.roles),
             (SELECT last_value FROM public.roles_id_seq)), true);
COMMIT;

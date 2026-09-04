    -- Datos de prueba para visualizar y probar el botón PAGAR desde admin/pagos.
    -- Esta migración NO se ejecuta automáticamente y no modifica consumos ni pagos reales.
    -- Todos los importes de pagos están limitados a ARS 0.10.

    BEGIN;

    -- La cuenta de Admin solo muestra consumos cuyo responsable es la empresa.
    -- Se agrega de forma idempotente porque instalaciones anteriores pueden no
    -- tener todavía esta columna en el historial de consumos.
    ALTER TABLE consumos_reserva
        ADD COLUMN IF NOT EXISTS responsable_pago text;

    DO $$
    BEGIN
        IF to_regclass('public.reservas') IS NULL
        OR to_regclass('public.usuarios') IS NULL
        OR to_regclass('public.vehiculos') IS NULL
        OR to_regclass('public.trato_empresa_garage') IS NULL
        OR to_regclass('public.consumos_reserva') IS NULL
        OR to_regclass('public.pagos') IS NULL THEN
            RAISE EXCEPTION 'Faltan tablas requeridas para 20260904_002_seed_consumos_pendientes_test';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM usuarios u
            JOIN vehiculos v ON v.id = 63 AND v.id_usuario = u.id
            JOIN trato_empresa_garage t ON t.id IN (4, 6)
            WHERE u.id = 117
            AND u.id_empresa = 5
            AND u.id_sede = 4
            AND v.tipo_vehiculo::text = 'auto'
        ) THEN
            RAISE EXCEPTION 'No se encontró el fixture esperado: usuario 117, empresa 5, sede 4 y vehículo 63';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM garages WHERE id = 29)
        OR NOT EXISTS (SELECT 1 FROM garages WHERE id = 26)
        OR NOT EXISTS (SELECT 1 FROM trato_empresa_garage WHERE id = 6 AND id_sede = 4 AND id_garage = 29)
        OR NOT EXISTS (SELECT 1 FROM trato_empresa_garage WHERE id = 4 AND id_sede = 4 AND id_garage = 26) THEN
            RAISE EXCEPTION 'No se encontraron los garages/tratos esperados para el fixture de pagos';
        END IF;
    END $$;

    WITH specs(test_key, id_usuario, id_garage, id_vehiculo, id_trato, fecha_entrada, fecha_salida, tarifa_hora, importe, estado_pago) AS (
        VALUES
            ('G29-2026-09', 117, 29, 63, 6, timestamp '2026-09-01 09:00:00', timestamp '2026-09-01 10:00:00', 2000.00::numeric, 2000.00::numeric, 'pending'),
            ('G29-2026-08', 117, 29, 63, 6, timestamp '2026-08-15 11:00:00', timestamp '2026-08-15 11:45:00', 2000.00::numeric, 1500.00::numeric, 'rejected'),
            ('G26-2026-08', 117, 26, 63, 4, timestamp '2026-08-20 15:00:00', timestamp '2026-08-20 16:30:00', 3200.00::numeric, 4800.00::numeric, 'pending')
    ), inserted_reservas AS (
        INSERT INTO reservas (
            id_usuario, id_garage, id_vehiculo, fecha_entrada, fecha_salida,
            entro, salio, "Borrado", id_trato, tarifa_hora_aplicada, importe_estimado
        )
        SELECT
            s.id_usuario, s.id_garage, s.id_vehiculo, s.fecha_entrada, s.fecha_salida,
            true, true, false, s.id_trato, s.tarifa_hora, s.importe
        FROM specs s
        WHERE NOT EXISTS (
            SELECT 1
            FROM reservas r
            WHERE r.id_usuario = s.id_usuario
            AND r.id_garage = s.id_garage
            AND r.id_vehiculo = s.id_vehiculo
            AND r.fecha_entrada = s.fecha_entrada
            AND r.fecha_salida = s.fecha_salida
            AND COALESCE(r."Borrado", false) = false
        )
        RETURNING id, id_usuario, id_garage, id_vehiculo, fecha_entrada, fecha_salida
    ), test_reservas AS (
        SELECT id, id_usuario, id_garage, id_vehiculo, fecha_entrada, fecha_salida
        FROM inserted_reservas
        UNION ALL
        SELECT r.id, r.id_usuario, r.id_garage, r.id_vehiculo, r.fecha_entrada, r.fecha_salida
        FROM reservas r
        JOIN specs s
        ON s.id_usuario = r.id_usuario
        AND s.id_garage = r.id_garage
        AND s.id_vehiculo = r.id_vehiculo
        AND s.fecha_entrada = r.fecha_entrada
        AND s.fecha_salida = r.fecha_salida
        WHERE NOT EXISTS (SELECT 1 FROM inserted_reservas ir WHERE ir.id = r.id)
), inserted_consumos AS (
        INSERT INTO consumos_reserva (
            id_reserva, id_trato, id_sede, id_empresa, id_garage, tipo_vehiculo,
            fecha_inicio, fecha_fin, minutos_facturados, tarifa_hora_aplicada,
            importe_generado, responsable_pago
        )
        SELECT
            r.id,
            s.id_trato,
            u.id_sede,
            u.id_empresa,
            s.id_garage,
            v.tipo_vehiculo,
            s.fecha_entrada,
            s.fecha_salida,
            ROUND(EXTRACT(EPOCH FROM (s.fecha_salida - s.fecha_entrada)) / 60.0)::integer,
            s.tarifa_hora,
            s.importe,
            'empresa'
        FROM test_reservas r
        JOIN specs s
        ON s.id_usuario = r.id_usuario
        AND s.id_garage = r.id_garage
        AND s.id_vehiculo = r.id_vehiculo
        AND s.fecha_entrada = r.fecha_entrada
        AND s.fecha_salida = r.fecha_salida
        JOIN usuarios u ON u.id = r.id_usuario
        JOIN vehiculos v ON v.id = r.id_vehiculo
        WHERE NOT EXISTS (
            SELECT 1 FROM consumos_reserva c WHERE c.id_reserva = r.id
        )
    RETURNING id, id_reserva, id_empresa, id_garage, id_sede, fecha_inicio
), all_test_consumos AS (
    SELECT id, id_reserva, id_empresa, id_garage, id_sede, fecha_inicio
    FROM inserted_consumos
    UNION ALL
    SELECT c.id, c.id_reserva, c.id_empresa, c.id_garage, c.id_sede, c.fecha_inicio
    FROM consumos_reserva c
    JOIN test_reservas r ON r.id = c.id_reserva
    WHERE NOT EXISTS (SELECT 1 FROM inserted_consumos ic WHERE ic.id = c.id)
    )
    INSERT INTO pagos (
        id_reserva, id_orden_externa, mp_preference_id, mp_payment_id,
        mp_payment_status, mp_payment_type, monto, moneda, descripcion,
        fecha_creacion, fecha_actualizacion, metadata, id_empresa
    )
    SELECT
        c.id_reserva,
        'ADMIN-PAGO-' || to_char(s.fecha_entrada, 'YYYY-MM') || '-G' || c.id_garage || '-S' || c.id_sede || '-SEED-20260904',
        'TEST-PREF-SEED-20260904-' || s.test_key,
        'TEST-MP-SEED-20260904-' || s.test_key,
        s.estado_pago,
        CASE WHEN s.estado_pago = 'pending' THEN 'ticket' ELSE 'credit_card' END,
        LEAST(GREATEST(s.importe, 0.01), 0.10),
        'ARS',
        'Pago de prueba pendiente para admin/pagos (' || s.test_key || ')',
        now() - interval '1 day',
        now() - interval '1 day',
        jsonb_build_object(
            'test', true,
            'origen', '20260904_002_seed_consumos_pendientes_test',
            'consumos_ids', jsonb_build_array(c.id),
            'reservas_ids', jsonb_build_array(c.id_reserva),
            'periodo', to_char(s.fecha_entrada, 'YYYY-MM'),
            'id_garage', c.id_garage,
            'id_sede', c.id_sede,
            'importe_original', s.importe,
            'importe_cobrado', LEAST(GREATEST(s.importe, 0.01), 0.10)
        ),
        c.id_empresa
FROM all_test_consumos c
JOIN specs s
  ON s.id_garage = c.id_garage
 AND s.fecha_entrada = c.fecha_inicio
    WHERE NOT EXISTS (
        SELECT 1
        FROM pagos p
        WHERE p.mp_payment_id = 'TEST-MP-SEED-20260904-' || s.test_key
    )
    ON CONFLICT (mp_payment_id) DO NOTHING;

    -- También corrige ejecuciones previas de esta migración, que podían haber
    -- creado los consumos sin responsable_pago y por eso no aparecían en Admin.
    UPDATE consumos_reserva c
    SET responsable_pago = 'empresa', updated_at = NOW()
    WHERE c.id_reserva IN (
        SELECT p.id_reserva
        FROM pagos p
        WHERE p.mp_payment_id LIKE 'TEST-MP-SEED-20260904-%'
    );

    COMMIT;

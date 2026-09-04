-- Migración: pagos de prueba para testear funcionalidad PAGAR con montos ≤ $0.10 (sandbox)
-- Crea tablas de Mercado Pago si no existen y siembra pagos pasados vinculados a consumos_reserva
-- Requisitos: montos máximos $0.10 para permitir múltiples testeos con saldo chico en sandbox MP
-- Vinculación: metadata.consumos_ids contiene los IDs de consumos_reserva del grupo (garage/sede/periodo)

BEGIN;

-- Habilitar extensión para gen_random_uuid() en Supabase/Postgres
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Tabla pagos (idempotente, compatible con docs y paymentController)
CREATE TABLE IF NOT EXISTS pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_reserva integer REFERENCES reservas(id) ON DELETE SET NULL,
    id_orden_externa VARCHAR(100),
    mp_preference_id VARCHAR(100) UNIQUE,
    mp_payment_id VARCHAR(100) UNIQUE,
    mp_payment_status VARCHAR(50) DEFAULT 'pending',
    mp_payment_type VARCHAR(50),
    monto DECIMAL(12,2) NOT NULL CHECK (monto >= 0 AND monto <= 999999999.99),
    moneda VARCHAR(3) DEFAULT 'ARS',
    descripcion TEXT,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_aprobacion TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    id_empresa integer REFERENCES empresas(id) ON DELETE SET NULL
);

-- Asegurar columnas si la tabla ya existía con esquema previo
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS id_reserva integer REFERENCES reservas(id) ON DELETE SET NULL;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS id_orden_externa VARCHAR(100);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS mp_preference_id VARCHAR(100);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS mp_payment_id VARCHAR(100);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS mp_payment_status VARCHAR(50);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS mp_payment_type VARCHAR(50);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS monto DECIMAL(12,2);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) DEFAULT 'ARS';
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMPTZ;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS id_empresa integer;

-- Índices para pagos
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_mp_payment_id ON pagos(mp_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_mp_preference_id ON pagos(mp_preference_id);
CREATE INDEX IF NOT EXISTS idx_pagos_id_reserva ON pagos(id_reserva);
CREATE INDEX IF NOT EXISTS idx_pagos_id_orden_externa ON pagos(id_orden_externa);
CREATE INDEX IF NOT EXISTS idx_pagos_id_empresa ON pagos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_pagos_status ON pagos(mp_payment_status);
CREATE INDEX IF NOT EXISTS idx_pagos_metadata_gin ON pagos USING GIN (metadata);

-- 2) Tabla reembolsos
CREATE TABLE IF NOT EXISTS reembolsos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_pago UUID REFERENCES pagos(id) ON DELETE CASCADE,
    mp_refund_id VARCHAR(100) UNIQUE,
    monto DECIMAL(12,2) NOT NULL CHECK (monto >= 0),
    moneda VARCHAR(3) DEFAULT 'ARS',
    estado VARCHAR(50),
    motivo VARCHAR(255),
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reembolsos_mp_refund_id ON reembolsos(mp_refund_id);
CREATE INDEX IF NOT EXISTS idx_reembolsos_id_pago ON reembolsos(id_pago);

-- 3) Tabla webhook_eventos
CREATE TABLE IF NOT EXISTS webhook_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mp_event_id VARCHAR(100),
    tipo_evento VARCHAR(100),
    mp_payment_id VARCHAR(100),
    payload JSONB NOT NULL,
    firma_valida BOOLEAN DEFAULT FALSE,
    procesado BOOLEAN DEFAULT FALSE,
    error_procesamiento TEXT,
    fecha_recepcion TIMESTAMPTZ DEFAULT NOW(),
    fecha_procesamiento TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_eventos_mp_event_id ON webhook_eventos(mp_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_eventos_mp_payment_id ON webhook_eventos(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_eventos_procesado ON webhook_eventos(procesado);

-- 4) Siembra de pagos pasados de prueba (≤ $0.10) vinculados a consumos_reserva existentes
-- Estrategia: agrupar consumos por empresa/garage/sede/periodo, tomar hasta 5 grupos,
-- y crear un pago por grupo con monto = LEAST(total_importe, 0.10) para testing sandbox
-- Metadata guarda consumos_ids para que el backend pueda marcar el grupo como PAGADA
-- Los pagos de prueba usan prefijos TEST- y ADMIN-PAGO- para distinguirse y no colisionar con pagos reales

DO $$
DECLARE
  grupo RECORD;
  idx integer := 0;
  pagos_insertados integer := 0;
  monto_capped numeric(12,2);
  order_id text;
  pref_id text;
  pay_id text;
  estado text;
  descripcion_pago text;
BEGIN
  -- Solo sembrar si existe la tabla consumos_reserva y tiene datos
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consumos_reserva') THEN
    RAISE NOTICE 'Tabla consumos_reserva no existe, se omite siembra de pagos de prueba';
    RETURN;
  END IF;

  -- Si ya existen pagos de prueba, no duplicar
  IF EXISTS (SELECT 1 FROM pagos WHERE id_orden_externa LIKE 'ADMIN-PAGO-%-TEST-%' OR mp_payment_id LIKE 'TEST-MP-%' LIMIT 1) THEN
    RAISE NOTICE 'Pagos de prueba ya existen, se omite reinserción (idempotente)';
    RETURN;
  END IF;

  FOR grupo IN
    WITH grupo_agg AS (
      SELECT
        c.id_empresa,
        c.id_garage,
        c.id_sede,
        to_char(c.fecha_inicio, 'YYYY-MM') AS periodo,
        array_agg(c.id ORDER BY c.id) AS consumos_ids,
        array_agg(c.id_reserva ORDER BY c.id) AS reservas_ids,
        SUM(c.importe_generado) AS total_importe,
        MIN(c.fecha_inicio) AS fecha_inicio_min,
        MAX(c.fecha_inicio) AS fecha_inicio_max,
        COUNT(*) AS cant_consumos
      FROM consumos_reserva c
      GROUP BY c.id_empresa, c.id_garage, c.id_sede, periodo
      ORDER BY periodo DESC, c.id_garage ASC
      LIMIT 5
    )
    SELECT * FROM grupo_agg
  LOOP
    idx := idx + 1;
    -- Cap a $0.10 máximo para sandbox con saldo chico, mínimo $0.05 para que sea visible
    monto_capped := LEAST(GREATEST(grupo.total_importe, 0.05), 0.10::numeric);
    -- Variar montos para testing: 0.05, 0.07, 0.10, 0.08, 0.06
    IF idx = 1 THEN monto_capped := 0.05;
    ELSIF idx = 2 THEN monto_capped := 0.07;
    ELSIF idx = 3 THEN monto_capped := 0.10;
    ELSIF idx = 4 THEN monto_capped := 0.08;
    ELSIF idx = 5 THEN monto_capped := 0.06;
    END IF;

    -- Primeros 2 grupos = approved (aparecerán como PAGADA), resto = pending/rejected para testear botón PAGAR
    IF idx <= 2 THEN estado := 'approved';
    ELSIF idx = 3 THEN estado := 'pending';
    ELSIF idx = 4 THEN estado := 'rejected';
    ELSE estado := 'pending';
    END IF;

    order_id := 'ADMIN-PAGO-' || grupo.periodo || '-G' || grupo.id_garage || '-S' || grupo.id_sede || '-TEST-' || substr(gen_random_uuid()::text, 1, 8);
    pref_id  := 'TEST-PREF-' || gen_random_uuid()::text;
    pay_id   := 'TEST-MP-' || (1000000000 + (random()*900000000)::bigint)::text || substr(gen_random_uuid()::text, 1, 4);

    descripcion_pago := 'Pago consumo ' || grupo.periodo || ' · Garage ' || grupo.id_garage || ' · Sede ' || grupo.id_sede || ' (' || grupo.cant_consumos || ' reservas)';

    BEGIN
      INSERT INTO pagos (
        id_reserva,
        id_orden_externa,
        mp_preference_id,
        mp_payment_id,
        mp_payment_status,
        mp_payment_type,
        monto,
        moneda,
        descripcion,
        fecha_aprobacion,
        metadata,
        id_empresa
      ) VALUES (
        grupo.reservas_ids[1],
        order_id,
        pref_id,
        pay_id,
        estado,
        CASE WHEN estado = 'approved' THEN 'credit_card' WHEN estado = 'pending' THEN 'ticket' ELSE 'credit_card' END,
        monto_capped,
        'ARS',
        descripcion_pago,
        CASE WHEN estado = 'approved' THEN NOW() - (idx || ' days')::interval ELSE NULL END,
        jsonb_build_object(
          'consumos_ids', to_jsonb(grupo.consumos_ids),
          'reservas_ids', to_jsonb(grupo.reservas_ids),
          'periodo', grupo.periodo,
          'id_garage', grupo.id_garage,
          'id_sede', grupo.id_sede,
          'cant_consumos', grupo.cant_consumos,
          'importe_original', grupo.total_importe,
          'importe_cobrado', monto_capped,
          'test', true,
          'origen', 'migracion_pagos_pasados',
          'nota', 'Monto capado a $0.10 max para testing sandbox MP con saldo chico'
        ),
        grupo.id_empresa
      )
      ON CONFLICT (mp_payment_id) DO NOTHING;
      GET DIAGNOSTICS pagos_insertados = ROW_COUNT;
      IF pagos_insertados > 0 THEN
        RAISE NOTICE 'Pago de prueba % insertado: % estado=% monto=% periodo=% garage=% sede=% consumos=%',
          idx, order_id, estado, monto_capped, grupo.periodo, grupo.id_garage, grupo.id_sede, grupo.consumos_ids;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo insertar pago de prueba %: %', idx, SQLERRM;
    END;
  END LOOP;

  -- Si no había consumos_reserva, crear al menos 2 pagos dummy para que la funcionalidad sea testeable
  IF idx = 0 THEN
    RAISE NOTICE 'No hay consumos_reserva, creando pagos dummy de prueba sin consumo vinculado';
    FOR idx IN 1..2 LOOP
      monto_capped := CASE WHEN idx = 1 THEN 0.05 ELSE 0.10 END;
      estado := CASE WHEN idx = 1 THEN 'approved' ELSE 'pending' END;
      order_id := 'ADMIN-PAGO-DUMMY-TEST-' || substr(gen_random_uuid()::text, 1, 8) || '-' || idx;
      pref_id  := 'TEST-PREF-DUMMY-' || gen_random_uuid()::text;
      pay_id   := 'TEST-MP-DUMMY-' || (2000000000 + idx)::text || substr(gen_random_uuid()::text, 1, 4);
      -- Intentar obtener una empresa existente para id_empresa
      BEGIN
        INSERT INTO pagos (id_orden_externa, mp_preference_id, mp_payment_id, mp_payment_status, mp_payment_type, monto, moneda, descripcion, fecha_aprobacion, metadata, id_empresa)
        SELECT order_id, pref_id, pay_id, estado, 'credit_card', monto_capped, 'ARS',
               'Pago dummy de prueba $' || monto_capped || ' para testear PAGAR/PAGADA',
               CASE WHEN estado='approved' THEN NOW() - (idx || ' days')::interval ELSE NULL END,
               jsonb_build_object('test', true, 'dummy', true, 'importe_cobrado', monto_capped, 'nota', 'Pago dummy sin consumo, monto capado $0.10 max'),
               (SELECT id FROM empresas ORDER BY id LIMIT 1)
        ON CONFLICT (mp_payment_id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo insertar pago dummy %: %', idx, SQLERRM;
      END;
    END LOOP;
  END IF;

  RAISE NOTICE 'Migración pagos pasados completada: % grupos procesados', idx;
END $$;

COMMIT;

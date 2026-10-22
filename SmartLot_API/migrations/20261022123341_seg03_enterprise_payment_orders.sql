BEGIN;
CREATE TABLE enterprise_payment_orders (
  reference varchar(100) PRIMARY KEY,
  id_empresa integer NOT NULL REFERENCES empresas(id),
  id_sede integer REFERENCES sedes(id),
  expected_amount numeric(12,2) NOT NULL CHECK (expected_amount > 0),
  currency varchar(3) NOT NULL CHECK (currency = 'ARS'),
  preference_id varchar(100) UNIQUE,
  payment_id varchar(100) UNIQUE,
  settled boolean NOT NULL DEFAULT false,
  review_reason text,
  provider_snapshot jsonb,
  reversal_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);
CREATE TABLE enterprise_payment_consumptions (
  reference varchar(100) NOT NULL REFERENCES enterprise_payment_orders(reference),
  consumption_id bigint PRIMARY KEY REFERENCES consumos_reserva(id),
  expected_amount numeric(12,2) NOT NULL CHECK (expected_amount > 0)
);
CREATE INDEX ON enterprise_payment_consumptions(reference);
CREATE INDEX ON enterprise_payment_orders(id_empresa);
ALTER TABLE enterprise_payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_payment_consumptions ENABLE ROW LEVEL SECURITY;
-- Solo el backend con su conexion PostgreSQL privilegiada. Sin politicas para el navegador.
REVOKE ALL ON enterprise_payment_orders, enterprise_payment_consumptions FROM PUBLIC;
-- Diagnostico explicito, sin reescribir pagos historicos ni inferir imputaciones.
CREATE VIEW enterprise_payments_pending_regularization WITH (security_invoker = true) AS
SELECT p.id, p.id_empresa, p.id_orden_externa, p.mp_payment_id, p.monto, p.moneda,
       'legacy_without_verified_consumptions'::text AS reason
FROM pagos p
WHERE p.id_reserva IS NULL
  AND NOT EXISTS (SELECT 1 FROM enterprise_payment_orders eo WHERE eo.reference=p.id_orden_externa);
REVOKE ALL ON enterprise_payments_pending_regularization FROM PUBLIC;

DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON enterprise_payment_orders, enterprise_payment_consumptions, enterprise_payments_pending_regularization FROM %I', browser_role);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION protect_enterprise_payment_expectation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'enterprise_payment_consumptions' THEN
    RAISE EXCEPTION 'Las asociaciones e importes de una orden son inmutables';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se elimina la trazabilidad de una orden';
  END IF;
  IF (NEW.reference, NEW.id_empresa, NEW.id_sede, NEW.expected_amount, NEW.currency)
     IS DISTINCT FROM (OLD.reference, OLD.id_empresa, OLD.id_sede, OLD.expected_amount, OLD.currency)
     OR (OLD.preference_id IS NOT NULL AND NEW.preference_id IS DISTINCT FROM OLD.preference_id)
     OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id) THEN
    RAISE EXCEPTION 'La expectativa y correlacion de una orden son inmutables';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_enterprise_payment_order BEFORE UPDATE OR DELETE ON enterprise_payment_orders
FOR EACH ROW EXECUTE FUNCTION protect_enterprise_payment_expectation();
CREATE TRIGGER protect_enterprise_payment_consumptions BEFORE UPDATE OR DELETE ON enterprise_payment_consumptions
FOR EACH ROW EXECUTE FUNCTION protect_enterprise_payment_expectation();
COMMIT;

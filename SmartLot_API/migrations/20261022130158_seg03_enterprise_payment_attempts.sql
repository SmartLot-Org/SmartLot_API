BEGIN;

ALTER TABLE enterprise_payment_orders
  ADD COLUMN accepted_payment_id varchar(100) UNIQUE,
  ADD COLUMN reconciliation_issue text;

CREATE TABLE enterprise_payment_attempts (
  payment_id varchar(100) PRIMARY KEY,
  reference varchar(100) NOT NULL REFERENCES enterprise_payment_orders(reference),
  provider_snapshot jsonb,
  eligible_snapshot jsonb,
  reversal_snapshot jsonb,
  legacy_evidence jsonb,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON enterprise_payment_attempts(reference);
ALTER TABLE enterprise_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON enterprise_payment_attempts FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON enterprise_payment_attempts FROM %I', browser_role);
    END IF;
  END LOOP;
END;
$$;

-- Conservar toda la evidencia anterior, incluso snapshots que el defecto asocio
-- al intento incorrecto. No se infiere una nueva liquidacion durante la migracion.
INSERT INTO enterprise_payment_attempts(payment_id, reference, legacy_evidence)
SELECT payment_id, reference, jsonb_build_object(
  'provider_snapshot', provider_snapshot, 'reversal_snapshot', reversal_snapshot,
  'settled', settled, 'review_reason', review_reason)
FROM enterprise_payment_orders WHERE payment_id IS NOT NULL;

-- La vinculacion aceptada anterior se conserva si hay liquidacion verificada,
-- evidencia economica aprobada del pago local, o una reversion del mismo pago.
UPDATE enterprise_payment_orders eo SET accepted_payment_id=eo.payment_id
WHERE eo.payment_id IS NOT NULL AND (
  eo.settled OR EXISTS (
    SELECT 1 FROM pagos p
    CROSS JOIN LATERAL (SELECT COALESCE(p.metadata->'_mp_payment_summary', eo.provider_snapshot) AS evidence) e
    WHERE p.id_orden_externa=eo.reference AND p.mp_preference_id=eo.preference_id
      AND p.mp_payment_id=eo.payment_id
      AND e.evidence->>'id'=eo.payment_id
      AND e.evidence->>'external_reference'=eo.reference
      AND (e.evidence->>'preference_id'=eo.preference_id
           OR (e.evidence->>'preference_id' IS NULL AND e.evidence->'order'->>'id' IS NOT NULL))
      AND e.evidence->>'currency_id'=eo.currency
      AND CASE WHEN e.evidence->>'transaction_amount' ~ '^[0-9]+([.][0-9]{1,2})?$'
               THEN (e.evidence->>'transaction_amount')::numeric=eo.expected_amount ELSE false END
      AND (
        (e.evidence->>'status'='approved' AND
          (e.evidence->>'transaction_amount_refunded' IN ('0','0.0','0.00')
           OR (NOT (e.evidence ? 'transaction_amount_refunded') AND e.evidence->'refunds'='[]'::jsonb)))
        OR p.metadata ? 'lastRefundId'
        OR (eo.reversal_snapshot->>'id'=eo.payment_id
            AND eo.reversal_snapshot->>'external_reference'=eo.reference
            AND (eo.reversal_snapshot->>'preference_id'=eo.preference_id OR (
              eo.reversal_snapshot->>'preference_id' IS NULL
              AND eo.reversal_snapshot->'order'->>'id' IS NOT NULL
              AND p.metadata->'_mp_payment_summary'=eo.reversal_snapshot)))
      )
  )
);

-- Una reversion de otro intento no es evidencia contra el pago aceptado.
-- El original queda conservado en legacy_evidence.
UPDATE enterprise_payment_orders SET reversal_snapshot=NULL
WHERE reversal_snapshot IS NOT NULL
  AND NOT COALESCE(
    accepted_payment_id IS NOT NULL AND reversal_snapshot->>'id'=accepted_payment_id
    AND reversal_snapshot->>'external_reference'=reference
    AND reversal_snapshot->>'currency_id'=currency
    AND CASE WHEN reversal_snapshot->>'transaction_amount' ~ '^[0-9]+([.][0-9]{1,2})?$'
             THEN (reversal_snapshot->>'transaction_amount')::numeric=expected_amount ELSE false END
    AND (reversal_snapshot->>'preference_id'=preference_id OR (
      reversal_snapshot->>'preference_id' IS NULL AND reversal_snapshot->'order'->>'id' IS NOT NULL
      AND EXISTS (SELECT 1 FROM pagos p WHERE p.id_orden_externa=enterprise_payment_orders.reference
        AND p.mp_payment_id=accepted_payment_id AND p.metadata->'_mp_payment_summary'=reversal_snapshot)
    )), false);

CREATE OR REPLACE FUNCTION protect_enterprise_payment_expectation() RETURNS trigger LANGUAGE plpgsql AS $$
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
     OR (OLD.accepted_payment_id IS NOT NULL AND
         (NEW.accepted_payment_id IS DISTINCT FROM OLD.accepted_payment_id
          OR NEW.payment_id IS DISTINCT FROM OLD.payment_id))
     OR (NEW.accepted_payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM NEW.accepted_payment_id) THEN
    RAISE EXCEPTION 'La expectativa y el pago aceptado de una orden son inmutables';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;

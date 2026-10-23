BEGIN;
ALTER TABLE public.password_reset_codes
    ADD COLUMN failed_attempts smallint NOT NULL DEFAULT 0,
    ADD CONSTRAINT password_reset_codes_failed_attempts_check CHECK (failed_attempts BETWEEN 0 AND 5);
-- No se conoce el presupuesto ya utilizado por los codigos legacy: invalidarlos.
-- Se conserva el historial (tambien para el limite de emision de 15 minutos).
UPDATE public.password_reset_codes SET usado=true WHERE usado=false;
CREATE UNIQUE INDEX password_reset_codes_one_available
    ON public.password_reset_codes(id_usuario) WHERE usado=false;
CREATE INDEX password_reset_codes_issuance_window
    ON public.password_reset_codes(id_usuario,creado_en DESC);
COMMIT;

-- SmartLot: snapshot del esquema public obtenido del catálogo de Supabase.
-- Fecha: 2026-10-16T12:16:51.984182+00:00 | PostgreSQL origen: 17.6
-- No es una salida de pg_dump directo. Ver database/README.md para procedencia.
-- Sin datos de negocio, propietarios ni ACL; permisos originales en source-permissions.json.
CREATE SCHEMA IF NOT EXISTS public;
SET search_path = public, pg_catalog;

CREATE TYPE public."dia_semana" AS ENUM ('Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo');
CREATE TYPE public."estado_reserva_enum" AS ENUM ('pendiente_pago', 'confirmada', 'expirada', 'cancelada');
COMMENT ON TYPE public."estado_reserva_enum" IS 'Estado de confirmación de la reserva; pendiente_pago representa una retención temporal.';
CREATE TYPE public."estado_solicitud" AS ENUM ('pendiente', 'aceptada', 'rechazada', 'cancelada');
CREATE TYPE public."modalidad_pago_trato_enum" AS ENUM ('empresa_cubre_cupo', 'empleado_paga_todo');
COMMENT ON TYPE public."modalidad_pago_trato_enum" IS 'Modalidad vigente de un trato: la empresa cubre su cupo o cada empleado paga sus reservas.';
CREATE TYPE public."responsable_pago_enum" AS ENUM ('empresa', 'empleado');
COMMENT ON TYPE public."responsable_pago_enum" IS 'Responsable económico inmutable asignado a una reserva o consumo.';
CREATE TYPE public."tipo_cupo_reserva_enum" AS ENUM ('dentro_cupo', 'extra');
COMMENT ON TYPE public."tipo_cupo_reserva_enum" IS 'Clasificación histórica de una reserva respecto del cupo simultáneo contratado.';
CREATE TYPE public."tipo_vehiculo_enum" AS ENUM ('auto', 'moto', 'pickup');

CREATE SEQUENCE public."consumos_reserva_id_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."email_templates_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."empresas_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."garage_dias_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."garages_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."marcas_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."modelos_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."notificaciones_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."password_reset_codes_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."reservas_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."roles_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."sedes_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."solicitudes_registro_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."usuario_garage_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."usuarios_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE public."vehiculos_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;

CREATE TABLE public."conflictos" (
    "id" bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public."conflictos_id_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1 NO CYCLE) NOT NULL,
    "id_usuario" bigint NOT NULL,
    "descripcion" text NOT NULL,
    "prioridad" character varying(20) NOT NULL,
    "estado" character varying(20) DEFAULT 'Pendiente'::character varying NOT NULL,
    "fecha_creacion" timestamp without time zone DEFAULT now() NOT NULL,
    "Borrado" boolean DEFAULT false NOT NULL,
    "SuperAdmin" boolean
);

CREATE TABLE public."consumos_reserva" (
    "id" bigint DEFAULT nextval('consumos_reserva_id_seq'::regclass) NOT NULL,
    "id_reserva" integer NOT NULL,
    "id_trato" integer NOT NULL,
    "id_sede" integer NOT NULL,
    "id_empresa" integer NOT NULL,
    "id_garage" integer NOT NULL,
    "tipo_vehiculo" tipo_vehiculo_enum NOT NULL,
    "fecha_inicio" timestamp without time zone NOT NULL,
    "fecha_fin" timestamp without time zone NOT NULL,
    "minutos_facturados" integer NOT NULL,
    "tarifa_hora_aplicada" numeric(14,2) NOT NULL,
    "importe_generado" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "modalidad_pago_aplicada" modalidad_pago_trato_enum DEFAULT 'empresa_cubre_cupo'::modalidad_pago_trato_enum NOT NULL,
    "tipo_cupo" tipo_cupo_reserva_enum DEFAULT 'dentro_cupo'::tipo_cupo_reserva_enum NOT NULL,
    "responsable_pago" responsable_pago_enum DEFAULT 'empresa'::responsable_pago_enum NOT NULL
);

CREATE TABLE public."email_templates" (
    "id" integer DEFAULT nextval('email_templates_id_seq'::regclass) NOT NULL,
    "codigo" text NOT NULL,
    "nombre" text NOT NULL,
    "descripcion" text,
    "asunto" text NOT NULL,
    "header_html" text DEFAULT ''::text NOT NULL,
    "cuerpo_html" text NOT NULL,
    "footer_html" text DEFAULT ''::text NOT NULL,
    "variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."empresas" (
    "id" integer DEFAULT nextval('empresas_id_seq'::regclass) NOT NULL,
    "nombre" character varying(255) NOT NULL,
    "descripcion" text,
    "DeleteBy" integer,
    "UpdateBy" integer,
    "DeleteAt" timestamp without time zone,
    "UpdateAt" timestamp without time zone,
    "Borrado" boolean
);

CREATE TABLE public."garage_dias" (
    "id" integer DEFAULT nextval('garage_dias_id_seq'::regclass) NOT NULL,
    "id_garage" integer NOT NULL,
    "dia" dia_semana NOT NULL,
    "activo" boolean
);

CREATE TABLE public."garages" (
    "id" integer DEFAULT nextval('garages_id_seq'::regclass) NOT NULL,
    "nombre" character varying(255) NOT NULL,
    "piso" integer,
    "ubicacion" character varying(255),
    "estado" boolean DEFAULT true,
    "capacidad" integer NOT NULL,
    "capacidad_para_no_reservas" integer,
    "capacidad_reservas" integer,
    "ocupacion_reservas" integer,
    "ocupacion_no_reservas" integer,
    "Borrado" boolean DEFAULT false NOT NULL,
    "hora_apertura" time without time zone,
    "hora_cierre" time without time zone,
    "latitud" numeric(10,8),
    "longitud" numeric(11,8),
    "precio_pickup" integer,
    "precio_auto" integer,
    "precio_moto" integer,
    "id_sede_propia" integer
);

CREATE TABLE public."historial_modalidad_trato" (
    "id" bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public."historial_modalidad_trato_id_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1 NO CYCLE) NOT NULL,
    "id_trato" bigint NOT NULL,
    "modalidad_anterior" modalidad_pago_trato_enum,
    "modalidad_nueva" modalidad_pago_trato_enum NOT NULL,
    "cambiado_por" integer,
    "fecha_cambio" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."marcas" (
    "id" integer DEFAULT nextval('marcas_id_seq'::regclass) NOT NULL,
    "nombre" character varying(255) NOT NULL,
    "Borrado" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."modelos" (
    "id" integer DEFAULT nextval('modelos_id_seq'::regclass) NOT NULL,
    "id_marca" integer,
    "nombre" character varying(255) NOT NULL,
    "Borrado" boolean DEFAULT false NOT NULL,
    "tipo_vehiculo" tipo_vehiculo_enum NOT NULL
);

CREATE TABLE public."notificaciones" (
    "id" integer DEFAULT nextval('notificaciones_id_seq'::regclass) NOT NULL,
    "id_usuario" integer NOT NULL,
    "id_garage" integer,
    "tipo" text NOT NULL,
    "mensaje" text NOT NULL,
    "actor_nombre" text,
    "id_relacion" integer,
    "leida" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."pagos" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "id_reserva" integer,
    "id_orden_externa" character varying(100),
    "mp_preference_id" character varying(100),
    "mp_payment_id" character varying(100),
    "mp_payment_status" character varying(50),
    "mp_payment_type" character varying(50),
    "monto" numeric(12,2) NOT NULL,
    "moneda" character varying(3) DEFAULT 'ARS'::character varying,
    "descripcion" text,
    "fecha_creacion" timestamp with time zone DEFAULT now(),
    "fecha_actualizacion" timestamp with time zone DEFAULT now(),
    "fecha_aprobacion" timestamp with time zone,
    "metadata" jsonb,
    "id_empresa" integer
);

CREATE TABLE public."password_reset_codes" (
    "id" integer DEFAULT nextval('password_reset_codes_id_seq'::regclass) NOT NULL,
    "id_usuario" integer NOT NULL,
    "codigo_hash" text NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "usado" boolean DEFAULT false NOT NULL,
    "creado_en" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."reembolsos" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "id_pago" uuid,
    "mp_refund_id" character varying(100),
    "monto" numeric(12,2) NOT NULL,
    "moneda" character varying(3) DEFAULT 'ARS'::character varying,
    "estado" character varying(50),
    "motivo" character varying(255),
    "fecha_creacion" timestamp with time zone DEFAULT now(),
    "fecha_actualizacion" timestamp with time zone DEFAULT now(),
    "metadata" jsonb
);

CREATE TABLE public."refresh_sessions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "usuario_id" integer NOT NULL,
    "token_version" integer NOT NULL,
    "refresh_token" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."reservas" (
    "id" integer DEFAULT nextval('reservas_id_seq'::regclass) NOT NULL,
    "id_usuario" integer,
    "id_garage" integer,
    "id_vehiculo" integer,
    "fecha_entrada" timestamp without time zone,
    "fecha_salida" timestamp without time zone,
    "entro" boolean DEFAULT false,
    "salio" boolean DEFAULT false,
    "Borrado" boolean DEFAULT false NOT NULL,
    "dia" dia_semana,
    "id_trato" bigint,
    "modalidad_pago_aplicada" modalidad_pago_trato_enum DEFAULT 'empresa_cubre_cupo'::modalidad_pago_trato_enum NOT NULL,
    "tipo_cupo" tipo_cupo_reserva_enum DEFAULT 'dentro_cupo'::tipo_cupo_reserva_enum NOT NULL,
    "responsable_pago" responsable_pago_enum DEFAULT 'empresa'::responsable_pago_enum NOT NULL,
    "tarifa_hora_aplicada" numeric(12,2),
    "importe_estimado" numeric(12,2),
    "estado_reserva" estado_reserva_enum DEFAULT 'confirmada'::estado_reserva_enum NOT NULL,
    "retencion_pago_hasta" timestamp with time zone,
    "qr_token" uuid DEFAULT gen_random_uuid() NOT NULL,
    "qr_salida_token" uuid
);

CREATE TABLE public."roles" (
    "id" integer DEFAULT nextval('roles_id_seq'::regclass) NOT NULL,
    "tipo_rol" character varying(50) NOT NULL,
    "Borrado" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."sedes" (
    "id" integer DEFAULT nextval('sedes_id_seq'::regclass) NOT NULL,
    "id_empresa" integer,
    "nombre" character varying(255) NOT NULL,
    "descripcion" text,
    "ubicacion" character varying(255),
    "Borrado" boolean DEFAULT false NOT NULL,
    "latitud" numeric(10,8),
    "longitud" numeric(11,8)
);

CREATE TABLE public."solicitudes" (
    "id" bigint GENERATED BY DEFAULT AS IDENTITY (SEQUENCE NAME public."solicitudes_id_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1 NO CYCLE) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "id_sede" integer NOT NULL,
    "id_garage" integer NOT NULL,
    "descripcion" text,
    "cantidad_cocheras" integer NOT NULL,
    "estado" estado_solicitud DEFAULT 'pendiente'::estado_solicitud NOT NULL,
    "modalidad_pago" modalidad_pago_trato_enum DEFAULT 'empresa_cubre_cupo'::modalidad_pago_trato_enum NOT NULL,
    "tipo_solicitud" text DEFAULT 'nueva'::text NOT NULL,
    "id_trato" integer
);

CREATE TABLE public."solicitudes_registro" (
    "id" integer DEFAULT nextval('solicitudes_registro_id_seq'::regclass) NOT NULL,
    "nombre" text NOT NULL,
    "apellido" text NOT NULL,
    "email" text NOT NULL,
    "telefono" text,
    "contraseña_hash" text NOT NULL,
    "empresa_nombre" text NOT NULL,
    "empresa_descripcion" text,
    "estado" text DEFAULT 'pendiente'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "revisada_at" timestamp with time zone,
    "revisada_por" integer
);

CREATE TABLE public."trato_empresa_garage" (
    "id" bigint GENERATED BY DEFAULT AS IDENTITY (SEQUENCE NAME public."trato_empresa_garage_id_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1 NO CYCLE) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "cantidad_cocheras" smallint,
    "precio_pickup" integer,
    "precio_auto" integer,
    "precio_moto" integer,
    "id_garage" integer,
    "id_sede" integer NOT NULL,
    "modalidad_pago" modalidad_pago_trato_enum DEFAULT 'empresa_cubre_cupo'::modalidad_pago_trato_enum NOT NULL,
    "Borrado" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."usuario_garage" (
    "id" integer DEFAULT nextval('usuario_garage_id_seq'::regclass) NOT NULL,
    "id_usuario" integer,
    "id_garage" integer
);

CREATE TABLE public."usuarios" (
    "id" integer DEFAULT nextval('usuarios_id_seq'::regclass) NOT NULL,
    "id_rol" integer,
    "nombre" character varying(255) NOT NULL,
    "apellido" character varying(255) NOT NULL,
    "id_sede" integer,
    "email" character varying(255) NOT NULL,
    "telefono" character varying(50),
    "contraseña" character varying(255) NOT NULL,
    "id_empresa" integer,
    "activo" boolean DEFAULT true,
    "token_version" integer DEFAULT 0 NOT NULL,
    "Borrado" boolean DEFAULT false NOT NULL,
    "DeleteBy" integer,
    "UpdateBy" integer,
    "DeleteAt" timestamp without time zone,
    "UpdateAt" timestamp without time zone,
    "limite_reservas_activas" smallint
);

CREATE TABLE public."vehiculos" (
    "id" integer DEFAULT nextval('vehiculos_id_seq'::regclass) NOT NULL,
    "id_usuario" integer,
    "id_modelo" integer,
    "patente" character varying(20) NOT NULL,
    "Borrado" boolean DEFAULT false NOT NULL,
    "tipo_vehiculo" tipo_vehiculo_enum NOT NULL
);

CREATE TABLE public."webhook_eventos" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "mp_event_id" character varying(100),
    "tipo_evento" character varying(100),
    "mp_payment_id" character varying(100),
    "payload" jsonb NOT NULL,
    "firma_valida" boolean DEFAULT false,
    "procesado" boolean DEFAULT false,
    "error_procesamiento" text,
    "fecha_recepcion" timestamp with time zone DEFAULT now(),
    "fecha_procesamiento" timestamp with time zone
);
ALTER SEQUENCE public."consumos_reserva_id_seq" OWNED BY public."consumos_reserva"."id";
ALTER SEQUENCE public."email_templates_id_seq" OWNED BY public."email_templates"."id";
ALTER SEQUENCE public."empresas_id_seq" OWNED BY public."empresas"."id";
ALTER SEQUENCE public."garage_dias_id_seq" OWNED BY public."garage_dias"."id";
ALTER SEQUENCE public."garages_id_seq" OWNED BY public."garages"."id";
ALTER SEQUENCE public."marcas_id_seq" OWNED BY public."marcas"."id";
ALTER SEQUENCE public."modelos_id_seq" OWNED BY public."modelos"."id";
ALTER SEQUENCE public."notificaciones_id_seq" OWNED BY public."notificaciones"."id";
ALTER SEQUENCE public."password_reset_codes_id_seq" OWNED BY public."password_reset_codes"."id";
ALTER SEQUENCE public."reservas_id_seq" OWNED BY public."reservas"."id";
ALTER SEQUENCE public."roles_id_seq" OWNED BY public."roles"."id";
ALTER SEQUENCE public."sedes_id_seq" OWNED BY public."sedes"."id";
ALTER SEQUENCE public."solicitudes_registro_id_seq" OWNED BY public."solicitudes_registro"."id";
ALTER SEQUENCE public."usuario_garage_id_seq" OWNED BY public."usuario_garage"."id";
ALTER SEQUENCE public."usuarios_id_seq" OWNED BY public."usuarios"."id";
ALTER SEQUENCE public."vehiculos_id_seq" OWNED BY public."vehiculos"."id";
ALTER TABLE ONLY public."conflictos" ADD CONSTRAINT "conflictos_estado_check" CHECK (estado::text = ANY (ARRAY['Pendiente'::character varying, 'En Proceso'::character varying, 'Resuelto'::character varying]::text[]));
ALTER TABLE ONLY public."conflictos" ADD CONSTRAINT "conflictos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."conflictos" ADD CONSTRAINT "conflictos_prioridad_check" CHECK (prioridad::text = ANY (ARRAY['Baja'::character varying, 'Media'::character varying, 'Alta'::character varying]::text[]));
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_modalidad_responsable_check" CHECK (modalidad_pago_aplicada = 'empresa_cubre_cupo'::modalidad_pago_trato_enum AND tipo_cupo = 'dentro_cupo'::tipo_cupo_reserva_enum AND responsable_pago = 'empresa'::responsable_pago_enum OR modalidad_pago_aplicada = 'empresa_cubre_cupo'::modalidad_pago_trato_enum AND tipo_cupo = 'extra'::tipo_cupo_reserva_enum AND responsable_pago = 'empleado'::responsable_pago_enum OR modalidad_pago_aplicada = 'empleado_paga_todo'::modalidad_pago_trato_enum AND responsable_pago = 'empleado'::responsable_pago_enum);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_id_reserva_key" UNIQUE (id_reserva);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_importe_generado_check" CHECK (importe_generado >= 0::numeric);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_minutos_facturados_check" CHECK (minutos_facturados >= 0);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_tarifa_hora_aplicada_check" CHECK (tarifa_hora_aplicada >= 0::numeric);
ALTER TABLE ONLY public."email_templates" ADD CONSTRAINT "email_templates_codigo_key" UNIQUE (codigo);
ALTER TABLE ONLY public."email_templates" ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."empresas" ADD CONSTRAINT "empresas_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."garage_dias" ADD CONSTRAINT "garage_dias_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."garage_dias" ADD CONSTRAINT "unique_garage_dia" UNIQUE (id_garage, dia);
ALTER TABLE ONLY public."garages" ADD CONSTRAINT "garages_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."historial_modalidad_trato" ADD CONSTRAINT "historial_modalidad_cambio_real_check" CHECK (modalidad_anterior IS NULL OR modalidad_anterior <> modalidad_nueva);
ALTER TABLE ONLY public."historial_modalidad_trato" ADD CONSTRAINT "historial_modalidad_trato_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."marcas" ADD CONSTRAINT "marcas_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."modelos" ADD CONSTRAINT "modelos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."notificaciones" ADD CONSTRAINT "notificaciones_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."pagos" ADD CONSTRAINT "pagos_mp_payment_id_key" UNIQUE (mp_payment_id);
ALTER TABLE ONLY public."pagos" ADD CONSTRAINT "pagos_mp_preference_id_key" UNIQUE (mp_preference_id);
ALTER TABLE ONLY public."pagos" ADD CONSTRAINT "pagos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."password_reset_codes" ADD CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."reembolsos" ADD CONSTRAINT "reembolsos_mp_refund_id_key" UNIQUE (mp_refund_id);
ALTER TABLE ONLY public."reembolsos" ADD CONSTRAINT "reembolsos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."refresh_sessions" ADD CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_empresa_sin_retencion_check" CHECK (responsable_pago <> 'empresa'::responsable_pago_enum OR retencion_pago_hasta IS NULL);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_importe_estimado_check" CHECK (importe_estimado IS NULL OR importe_estimado >= 0::numeric);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_modalidad_responsable_check" CHECK (modalidad_pago_aplicada = 'empresa_cubre_cupo'::modalidad_pago_trato_enum AND tipo_cupo = 'dentro_cupo'::tipo_cupo_reserva_enum AND responsable_pago = 'empresa'::responsable_pago_enum OR modalidad_pago_aplicada = 'empresa_cubre_cupo'::modalidad_pago_trato_enum AND tipo_cupo = 'extra'::tipo_cupo_reserva_enum AND responsable_pago = 'empleado'::responsable_pago_enum OR modalidad_pago_aplicada = 'empleado_paga_todo'::modalidad_pago_trato_enum AND responsable_pago = 'empleado'::responsable_pago_enum);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_qr_salida_distinto_chk" CHECK (qr_salida_token IS NULL OR qr_salida_token <> qr_token);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_retencion_pago_check" CHECK (estado_reserva = 'pendiente_pago'::estado_reserva_enum AND responsable_pago = 'empleado'::responsable_pago_enum AND retencion_pago_hasta IS NOT NULL OR estado_reserva <> 'pendiente_pago'::estado_reserva_enum);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_tarifa_hora_aplicada_check" CHECK (tarifa_hora_aplicada IS NULL OR tarifa_hora_aplicada >= 0::numeric);
ALTER TABLE ONLY public."roles" ADD CONSTRAINT "roles_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."sedes" ADD CONSTRAINT "sedes_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."solicitudes" ADD CONSTRAINT "solicitudes_cantidad_cocheras_check" CHECK (cantidad_cocheras > 0);
ALTER TABLE ONLY public."solicitudes" ADD CONSTRAINT "solicitudes_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."solicitudes_registro" ADD CONSTRAINT "solicitudes_registro_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."trato_empresa_garage" ADD CONSTRAINT "trato_empresa_garage_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."usuario_garage" ADD CONSTRAINT "usuario_garage_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."usuarios" ADD CONSTRAINT "usuarios_email_key" UNIQUE (email);
ALTER TABLE ONLY public."usuarios" ADD CONSTRAINT "usuarios_limite_reservas_activas_no_negativo" CHECK (limite_reservas_activas IS NULL OR limite_reservas_activas >= 0);
ALTER TABLE ONLY public."usuarios" ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."usuarios" ADD CONSTRAINT "usuarios_telefono_key" UNIQUE (telefono);
ALTER TABLE ONLY public."vehiculos" ADD CONSTRAINT "vehiculos_patente_key" UNIQUE (patente);
ALTER TABLE ONLY public."vehiculos" ADD CONSTRAINT "vehiculos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."webhook_eventos" ADD CONSTRAINT "webhook_eventos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."conflictos" ADD CONSTRAINT "fk_conflictos_usuario" FOREIGN KEY (id_usuario) REFERENCES usuarios(id);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_id_empresa_fkey" FOREIGN KEY (id_empresa) REFERENCES empresas(id);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_id_garage_fkey" FOREIGN KEY (id_garage) REFERENCES garages(id);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_id_reserva_fkey" FOREIGN KEY (id_reserva) REFERENCES reservas(id);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_id_sede_fkey" FOREIGN KEY (id_sede) REFERENCES sedes(id);
ALTER TABLE ONLY public."consumos_reserva" ADD CONSTRAINT "consumos_reserva_id_trato_fkey" FOREIGN KEY (id_trato) REFERENCES trato_empresa_garage(id);
ALTER TABLE ONLY public."garage_dias" ADD CONSTRAINT "fk_garage" FOREIGN KEY (id_garage) REFERENCES garages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."garages" ADD CONSTRAINT "garages_id_sede_propia_fkey" FOREIGN KEY (id_sede_propia) REFERENCES sedes(id);
ALTER TABLE ONLY public."historial_modalidad_trato" ADD CONSTRAINT "historial_modalidad_trato_cambiado_por_fkey" FOREIGN KEY (cambiado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."historial_modalidad_trato" ADD CONSTRAINT "historial_modalidad_trato_id_trato_fkey" FOREIGN KEY (id_trato) REFERENCES trato_empresa_garage(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public."modelos" ADD CONSTRAINT "modelos_id_marca_fkey" FOREIGN KEY (id_marca) REFERENCES marcas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."notificaciones" ADD CONSTRAINT "notificaciones_id_garage_fkey" FOREIGN KEY (id_garage) REFERENCES garages(id);
ALTER TABLE ONLY public."notificaciones" ADD CONSTRAINT "notificaciones_id_usuario_fkey" FOREIGN KEY (id_usuario) REFERENCES usuarios(id);
ALTER TABLE ONLY public."pagos" ADD CONSTRAINT "pagos_id_empresa_fkey" FOREIGN KEY (id_empresa) REFERENCES empresas(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."pagos" ADD CONSTRAINT "pagos_id_reserva_fkey" FOREIGN KEY (id_reserva) REFERENCES reservas(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."password_reset_codes" ADD CONSTRAINT "password_reset_codes_id_usuario_fkey" FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."reembolsos" ADD CONSTRAINT "reembolsos_id_pago_fkey" FOREIGN KEY (id_pago) REFERENCES pagos(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."refresh_sessions" ADD CONSTRAINT "refresh_sessions_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_id_garage_fkey" FOREIGN KEY (id_garage) REFERENCES garages(id);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_id_trato_fkey" FOREIGN KEY (id_trato) REFERENCES trato_empresa_garage(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_id_usuario_fkey" FOREIGN KEY (id_usuario) REFERENCES usuarios(id);
ALTER TABLE ONLY public."reservas" ADD CONSTRAINT "reservas_id_vehiculo_fkey" FOREIGN KEY (id_vehiculo) REFERENCES vehiculos(id);
ALTER TABLE ONLY public."sedes" ADD CONSTRAINT "sedes_id_empresa_fkey" FOREIGN KEY (id_empresa) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."solicitudes" ADD CONSTRAINT "solicitudes_id_garage_fkey" FOREIGN KEY (id_garage) REFERENCES garages(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public."solicitudes" ADD CONSTRAINT "solicitudes_id_sede_fkey" FOREIGN KEY (id_sede) REFERENCES sedes(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public."solicitudes" ADD CONSTRAINT "solicitudes_id_trato_fkey" FOREIGN KEY (id_trato) REFERENCES trato_empresa_garage(id);
ALTER TABLE ONLY public."solicitudes_registro" ADD CONSTRAINT "solicitudes_registro_revisada_por_fkey" FOREIGN KEY (revisada_por) REFERENCES usuarios(id);
ALTER TABLE ONLY public."trato_empresa_garage" ADD CONSTRAINT "fk_trato_sede" FOREIGN KEY (id_sede) REFERENCES sedes(id);
ALTER TABLE ONLY public."trato_empresa_garage" ADD CONSTRAINT "trato_empresa_garage_id_garage_fkey" FOREIGN KEY (id_garage) REFERENCES garages(id);
ALTER TABLE ONLY public."usuario_garage" ADD CONSTRAINT "usuario_garage_id_garage_fkey" FOREIGN KEY (id_garage) REFERENCES garages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."usuario_garage" ADD CONSTRAINT "usuario_garage_id_usuario_fkey" FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."usuarios" ADD CONSTRAINT "usuarios_id_empresa_fkey" FOREIGN KEY (id_empresa) REFERENCES empresas(id);
ALTER TABLE ONLY public."usuarios" ADD CONSTRAINT "usuarios_id_rol_fkey" FOREIGN KEY (id_rol) REFERENCES roles(id);
ALTER TABLE ONLY public."usuarios" ADD CONSTRAINT "usuarios_id_sede_fkey" FOREIGN KEY (id_sede) REFERENCES sedes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."vehiculos" ADD CONSTRAINT "vehiculos_id_modelo_fkey" FOREIGN KEY (id_modelo) REFERENCES modelos(id);
ALTER TABLE ONLY public."vehiculos" ADD CONSTRAINT "vehiculos_id_usuario_fkey" FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE CASCADE;
CREATE INDEX idx_consumos_empresa_responsable_periodo ON public.consumos_reserva USING btree (id_empresa, responsable_pago, fecha_inicio);
CREATE INDEX idx_consumos_garage_responsable_periodo ON public.consumos_reserva USING btree (id_garage, responsable_pago, fecha_inicio);
CREATE INDEX idx_consumos_reserva_empresa_periodo ON public.consumos_reserva USING btree (id_empresa, fecha_inicio);
CREATE INDEX idx_consumos_reserva_garage_periodo ON public.consumos_reserva USING btree (id_garage, fecha_inicio);
CREATE INDEX idx_consumos_reserva_id_trato ON public.consumos_reserva USING btree (id_trato);
CREATE INDEX idx_consumos_reserva_sede_periodo ON public.consumos_reserva USING btree (id_sede, fecha_inicio);
CREATE UNIQUE INDEX uq_garage_propio_sede ON public.garages USING btree (id_sede_propia) WHERE ((id_sede_propia IS NOT NULL) AND (COALESCE("Borrado", false) = false));
CREATE INDEX idx_historial_modalidad_trato_fecha ON public.historial_modalidad_trato USING btree (id_trato, fecha_cambio DESC);
CREATE INDEX idx_historial_modalidad_trato_usuario ON public.historial_modalidad_trato USING btree (cambiado_por);
CREATE INDEX idx_notificaciones_usuario ON public.notificaciones USING btree (id_usuario, leida, created_at DESC);
CREATE INDEX idx_pagos_id_empresa ON public.pagos USING btree (id_empresa);
CREATE INDEX idx_pagos_id_orden_externa ON public.pagos USING btree (id_orden_externa);
CREATE INDEX idx_pagos_id_reserva ON public.pagos USING btree (id_reserva);
CREATE INDEX idx_pagos_metadata_gin ON public.pagos USING gin (metadata);
CREATE INDEX idx_pagos_mp_payment_id ON public.pagos USING btree (mp_payment_id);
CREATE INDEX idx_pagos_mp_preference_id ON public.pagos USING btree (mp_preference_id);
CREATE INDEX idx_pagos_status ON public.pagos USING btree (mp_payment_status);
CREATE INDEX idx_reembolsos_id_pago ON public.reembolsos USING btree (id_pago);
CREATE INDEX idx_reembolsos_mp_refund_id ON public.reembolsos USING btree (mp_refund_id);
CREATE INDEX idx_refresh_sessions_id ON public.refresh_sessions USING btree (id);
CREATE INDEX idx_refresh_sessions_usuario ON public.refresh_sessions USING btree (usuario_id);
CREATE INDEX idx_reservas_disponibilidad_activas ON public.reservas USING btree (id_garage, fecha_entrada, fecha_salida) WHERE (("Borrado" = false) AND (estado_reserva = ANY (ARRAY['pendiente_pago'::estado_reserva_enum, 'confirmada'::estado_reserva_enum])));
CREATE INDEX idx_reservas_id_trato ON public.reservas USING btree (id_trato);
CREATE INDEX idx_reservas_usuario_vigentes ON public.reservas USING btree (id_usuario, estado_reserva, fecha_salida, retencion_pago_hasta) WHERE (("Borrado" = false) AND (estado_reserva = ANY (ARRAY['pendiente_pago'::estado_reserva_enum, 'confirmada'::estado_reserva_enum])));
CREATE UNIQUE INDEX uq_reservas_qr_salida_token ON public.reservas USING btree (qr_salida_token) WHERE (qr_salida_token IS NOT NULL);
CREATE UNIQUE INDEX uq_reservas_qr_token ON public.reservas USING btree (qr_token);
CREATE INDEX solicitudes_id_garage_estado_idx ON public.solicitudes USING btree (id_garage, estado);
CREATE INDEX solicitudes_id_sede_estado_idx ON public.solicitudes USING btree (id_sede, estado);
CREATE UNIQUE INDEX uq_solicitud_modificacion_pendiente ON public.solicitudes USING btree (id_trato) WHERE ((tipo_solicitud = 'modificacion'::text) AND (estado = 'pendiente'::estado_solicitud));
CREATE INDEX idx_solicitudes_registro_estado ON public.solicitudes_registro USING btree (estado, created_at DESC);
CREATE UNIQUE INDEX uq_solicitudes_registro_email_pendiente ON public.solicitudes_registro USING btree (email) WHERE (estado = 'pendiente'::text);
CREATE INDEX idx_trato_empresa_garage_activos ON public.trato_empresa_garage USING btree (id_garage) WHERE ("Borrado" = false);
CREATE INDEX idx_trato_empresa_garage_garage ON public.trato_empresa_garage USING btree (id_garage);
CREATE UNIQUE INDEX uq_trato_sede_garage ON public.trato_empresa_garage USING btree (id_sede, id_garage) WHERE ((id_sede IS NOT NULL) AND ("Borrado" = false));
CREATE UNIQUE INDEX idx_webhook_eventos_mp_event_id ON public.webhook_eventos USING btree (mp_event_id);
CREATE INDEX idx_webhook_eventos_mp_payment_id ON public.webhook_eventos USING btree (mp_payment_id);
CREATE INDEX idx_webhook_eventos_procesado ON public.webhook_eventos USING btree (procesado);

CREATE OR REPLACE FUNCTION public.reset_password_invalidate_anteriores(usuario_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE password_reset_codes
     SET usado = true
   WHERE id_usuario = usuario_id
     AND usado = false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.smartlot_propagate_model_type_to_vehicles()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
    BEGIN
      UPDATE public.vehiculos
      SET tipo_vehiculo = NEW.tipo_vehiculo
      WHERE id_modelo = NEW.id
        AND tipo_vehiculo IS DISTINCT FROM NEW.tipo_vehiculo;

      RETURN NEW;
    END
    $function$;

CREATE OR REPLACE FUNCTION public.smartlot_set_vehicle_type_from_model()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
    DECLARE
      v_tipo public.tipo_vehiculo_enum;
    BEGIN
      SELECT m.tipo_vehiculo
      INTO v_tipo
      FROM public.modelos AS m
      WHERE m.id = NEW.id_modelo
        AND m."Borrado" = false;

      IF v_tipo IS NULL THEN
        RAISE EXCEPTION
          'El modelo % no existe, está borrado o no tiene tipo de vehículo',
          NEW.id_modelo
          USING ERRCODE = '23514';
      END IF;

      NEW.tipo_vehiculo := v_tipo;
      RETURN NEW;
    END
    $function$;
CREATE TRIGGER trg_modelos_propagate_type_to_vehicles AFTER UPDATE OF tipo_vehiculo ON modelos FOR EACH ROW WHEN (old.tipo_vehiculo IS DISTINCT FROM new.tipo_vehiculo) EXECUTE FUNCTION smartlot_propagate_model_type_to_vehicles();
CREATE TRIGGER trg_vehiculos_set_type_from_model BEFORE INSERT OR UPDATE OF id_modelo, tipo_vehiculo ON vehiculos FOR EACH ROW EXECUTE FUNCTION smartlot_set_vehicle_type_from_model();
ALTER TABLE public."conflictos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."consumos_reserva" ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public."consumos_reserva" IS 'Snapshot inmutable del consumo generado por reservas completas; no representa pagos ni deuda.';
COMMENT ON COLUMN public."consumos_reserva"."modalidad_pago_aplicada" IS 'Snapshot de la modalidad de la reserva que originó el consumo.';
COMMENT ON COLUMN public."consumos_reserva"."tipo_cupo" IS 'Snapshot de si la reserva correspondió al cupo contratado o fue extra.';
COMMENT ON COLUMN public."consumos_reserva"."responsable_pago" IS 'Permite separar la cuenta empresarial de los importes pagados por empleados.';
ALTER TABLE public."email_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."empresas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."garage_dias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."garages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."historial_modalidad_trato" ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public."historial_modalidad_trato" IS 'Auditoría append-only de cambios de modalidad decididos por la empresa.';
COMMENT ON COLUMN public."historial_modalidad_trato"."cambiado_por" IS 'Usuario administrador que realizó el cambio; admite NULL para migraciones o usuarios eliminados.';
ALTER TABLE public."marcas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."modelos" ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public."modelos"."tipo_vehiculo" IS 'Tipo tarifario canónico del modelo: auto, moto o pickup. SUV, sedán, hatchback y utilitarios se clasifican como auto.';
ALTER TABLE public."notificaciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pagos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."password_reset_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."reembolsos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."refresh_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."reservas" ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public."reservas"."id_trato" IS 'Trato exacto utilizado al crear la reserva. Durante la transición del backend admite NULL.';
COMMENT ON COLUMN public."reservas"."modalidad_pago_aplicada" IS 'Snapshot inmutable de la modalidad vigente al crear la reserva.';
COMMENT ON COLUMN public."reservas"."tipo_cupo" IS 'Indica si la reserva utilizó el cupo contratado o una cochera extra.';
COMMENT ON COLUMN public."reservas"."responsable_pago" IS 'Responsable económico de esta reserva; no debe recalcularse desde la modalidad actual del trato.';
COMMENT ON COLUMN public."reservas"."tarifa_hora_aplicada" IS 'Snapshot de la tarifa negociada según el tipo de vehículo.';
COMMENT ON COLUMN public."reservas"."importe_estimado" IS 'Importe calculado con la duración reservada y la tarifa histórica.';
COMMENT ON COLUMN public."reservas"."retencion_pago_hasta" IS 'Vencimiento de la retención temporal mientras el empleado completa el pago.';
ALTER TABLE public."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sedes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."solicitudes" ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public."solicitudes"."modalidad_pago" IS 'Modalidad elegida por la empresa para el trato que se creará al aceptar la solicitud.';
ALTER TABLE public."solicitudes_registro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."trato_empresa_garage" ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public."trato_empresa_garage"."modalidad_pago" IS 'Configuración actual del trato. Sus cambios solo afectan reservas creadas posteriormente.';
ALTER TABLE public."usuario_garage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."usuarios" ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public."usuarios"."limite_reservas_activas" IS 'Cantidad maxima de reservas vigentes permitidas para el usuario. NULL significa sin limite; 0 bloquea nuevas reservas.';
ALTER TABLE public."vehiculos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."webhook_eventos" ENABLE ROW LEVEL SECURITY;

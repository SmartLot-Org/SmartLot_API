-- Plantillas de email editables desde el backoffice.
-- Los templates se guardan por secciones (header de marca, cuerpo, footer)
-- y usan placeholders {{variable}} que se reemplazan al renderizar.
BEGIN;

CREATE TABLE IF NOT EXISTS email_templates (
  id serial PRIMARY KEY,
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  descripcion text,
  asunto text NOT NULL,
  header_html text NOT NULL DEFAULT '',
  cuerpo_html text NOT NULL,
  footer_html text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]',
  activa boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Seed: plantillas actuales ─────────────────────────────────────
INSERT INTO email_templates (codigo, nombre, descripcion, asunto, header_html, cuerpo_html, footer_html, variables)
VALUES
(
  'bienvenida',
  'Bienvenida',
  'Se envía cuando una empresa crea una cuenta de usuario.',
  'Bienvenido a SmartLot',
  '<div style="background:linear-gradient(135deg, #0C1E3F 0%, #2A5CBF 100%);padding:40px 32px 36px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="margin:0 0 12px;"><span style="font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:900;font-size:28px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">Smart<span style="color:#6C93D6;">Lot</span></span></div>
    <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.02em;">El estacionamiento del futuro</p>
  </div>',
  '<div style="padding:36px 32px 32px;background-color:#FFFFFF;">
    <h2 style="margin:0 0 16px;font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:800;font-size:22px;color:#1E293B;letter-spacing:-0.02em;">¡Hola, {{nombre}}!</h2>
    <p style="margin:0 0 16px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:15px;line-height:1.7;color:#334155;">
        Tu cuenta en <strong>SmartLot</strong> fue creada exitosamente. Ya podés iniciar sesión y comenzar a gestionar tus estacionamientos de forma inteligente.
    </p>
    <div style="background:#EFF6FF;border-left:4px solid #2563EB;border-radius:10px;padding:18px 22px;margin:24px 0;">
        <p style="margin:6px 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:14px;line-height:1.6;color:#3B4A63;"><strong style="color:#2563EB;">Correo:</strong> {{email}}</p>
        <p style="margin:6px 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:14px;line-height:1.6;color:#3B4A63;"><strong style="color:#2563EB;">Contraseña:</strong> La que registró la empresa al crear tu cuenta</p>
    </div>
    <p style="text-align:center;margin:28px 0 8px;"><a href="{{link_login}}" style="display:inline-block;padding:14px 42px;background-color:#2563EB;color:#ffffff;text-decoration:none;border-radius:10px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(37,99,235,0.30);">Iniciar Sesión</a></p>
    <p style="margin:12px 0 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:13px;color:#64748B;text-align:center;">Por seguridad, no compartas tus credenciales con nadie.</p>
  </div>',
  '<div style="background:#0C1E3F;padding:26px 32px;text-align:center;border-radius:0 0 16px 16px;">
    <div style="margin:0 0 10px;"><span style="font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:900;font-size:16px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">Smart<span style="color:#6C93D6;">Lot</span></span></div>
    <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">
        © {{anio}} SmartLot — Todos los derechos reservados<br>
        Este es un mensaje automático, por favor no respondas a este correo.
    </p>
  </div>',
  '[{"variable":"nombre","ejemplo":"Juan Pérez"},{"variable":"email","ejemplo":"juan.perez@ejemplo.com"},{"variable":"link_login","ejemplo":"https://app.smartlot.com/login"}]'::jsonb
),
(
  'cambio_contraseña',
  'Cambio de contraseña',
  'Notifica al usuario que la contraseña de su cuenta fue cambiada.',
  'Contraseña Actualizada - SmartLot',
  '<div style="background:linear-gradient(135deg, #0C1E3F 0%, #2A5CBF 100%);padding:40px 32px 36px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="margin:0 0 12px;"><span style="font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:900;font-size:28px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">Smart<span style="color:#6C93D6;">Lot</span></span></div>
    <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.02em;">El estacionamiento del futuro</p>
  </div>',
  '<div style="padding:36px 32px 32px;background-color:#FFFFFF;">
    <h2 style="margin:0 0 16px;font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:800;font-size:22px;color:#1E293B;letter-spacing:-0.02em;">Hola, {{nombre}}</h2>
    <p style="margin:0 0 16px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:15px;line-height:1.7;color:#334155;">
        Te informamos que la contraseña de tu cuenta en <strong>SmartLot</strong> fue cambiada exitosamente.
    </p>
    <div style="background:#FEFCE8;border-left:4px solid #EAB308;border-radius:10px;padding:18px 22px;margin:24px 0;">
        <p style="margin:0 0 8px;font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:700;font-size:14px;color:#B45309;">¿No solicitaste este cambio?</p>
        <p style="margin:6px 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:14px;line-height:1.6;color:#7C5E10;">Si no realizaste esta acción, comunicate de inmediato con el administrador del sistema para proteger tu cuenta.</p>
    </div>
    <p style="text-align:center;margin:28px 0 8px;"><a href="{{link_login}}" style="display:inline-block;padding:14px 42px;background-color:#2563EB;color:#ffffff;text-decoration:none;border-radius:10px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(37,99,235,0.30);">Ir a SmartLot</a></p>
  </div>',
  '<div style="background:#0C1E3F;padding:26px 32px;text-align:center;border-radius:0 0 16px 16px;">
    <div style="margin:0 0 10px;"><span style="font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:900;font-size:16px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">Smart<span style="color:#6C93D6;">Lot</span></span></div>
    <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">
        © {{anio}} SmartLot — Todos los derechos reservados<br>
        Este es un mensaje automático, por favor no respondas a este correo.
    </p>
  </div>',
  '[{"variable":"nombre","ejemplo":"Juan Pérez"},{"variable":"link_login","ejemplo":"https://app.smartlot.com/login"}]'::jsonb
)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;

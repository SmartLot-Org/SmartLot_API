-- Plantillas para el flujo de solicitud de registro de empresas.
-- 1) solicitud_registro_superadmin: avisa a los superadmins con botones de
--    Aceptar / Rechazar que llevan a la página de confirmación del frontend
--    (/solicitud-registro/revision), donde se exige sesión de superadmin.
-- 2) solicitud_rechazada: avisa al solicitante que su solicitud fue rechazada.
BEGIN;

INSERT INTO email_templates (codigo, nombre, descripcion, asunto, header_html, cuerpo_html, footer_html, variables)
VALUES
(
  'solicitud_registro_superadmin',
  'Nueva solicitud de registro (superadmin)',
  'Notifica a los superadmins cuando un administrador de empresa envía una solicitud de registro.',
  'Nueva solicitud de registro - SmartLot',
  '<div style="background:linear-gradient(135deg, #0C1E3F 0%, #2A5CBF 100%);padding:40px 32px 36px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="margin:0 0 12px;"><span style="font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:900;font-size:28px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">Smart<span style="color:#6C93D6;">Lot</span></span></div>
    <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.02em;">El estacionamiento del futuro</p>
  </div>',
  '<div style="padding:36px 32px 32px;background-color:#FFFFFF;">
    <h2 style="margin:0 0 16px;font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:800;font-size:22px;color:#1E293B;letter-spacing:-0.02em;">Hola, {{nombre_superadmin}}</h2>
    <p style="margin:0 0 16px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:15px;line-height:1.7;color:#334155;">
        <strong>{{solicitante}}</strong> quiere registrar la empresa <strong>{{empresa_nombre}}</strong> en SmartLot.
    </p>
    <div style="background:#EFF6FF;border-left:4px solid #2563EB;border-radius:10px;padding:18px 22px;margin:24px 0;">
        <p style="margin:6px 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:14px;line-height:1.6;color:#3B4A63;"><strong style="color:#2563EB;">Solicitante:</strong> {{solicitante}} ({{email_solicitante}})</p>
        <p style="margin:6px 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:14px;line-height:1.6;color:#3B4A63;"><strong style="color:#2563EB;">Empresa:</strong> {{empresa_nombre}}</p>
        <p style="margin:6px 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:14px;line-height:1.6;color:#3B4A63;"><strong style="color:#2563EB;">Descripción:</strong> {{empresa_descripcion}}</p>
    </div>
    <p style="margin:24px 0 16px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:15px;line-height:1.7;color:#334155;">
        Revisá los datos y confirmá tu decisión: se te pedirá iniciar sesión como superadmin.
    </p>
    <p style="text-align:center;margin:28px 0 8px;">
        <a href="{{link_aceptar}}" style="display:inline-block;padding:14px 42px;background-color:#16A34A;color:#ffffff;text-decoration:none;border-radius:10px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(22,163,74,0.30);">Aceptar solicitud</a>
        <span style="display:inline-block;width:12px;"></span>
        <a href="{{link_rechazar}}" style="display:inline-block;padding:14px 42px;background-color:#DC2626;color:#ffffff;text-decoration:none;border-radius:10px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(220,38,38,0.30);">Rechazar</a>
    </p>
    <p style="text-align:center;margin:20px 0 0;">
        <a href="{{link_panel}}" style="color:#2563EB;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:13px;">Ver todas las solicitudes en el panel</a>
    </p>
    <p style="margin:12px 0 0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:13px;color:#64748B;text-align:center;">Por seguridad, la acción se confirma en SmartLot con tu sesión de superadmin.</p>
  </div>',
  '<div style="background:#0C1E3F;padding:26px 32px;text-align:center;border-radius:0 0 16px 16px;">
    <div style="margin:0 0 10px;"><span style="font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:900;font-size:16px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">Smart<span style="color:#6C93D6;">Lot</span></span></div>
    <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">
        © {{anio}} SmartLot — Todos los derechos reservados<br>
        Este es un mensaje automático, por favor no respondas a este correo.
    </p>
  </div>',
  '[{"variable":"nombre_superadmin","ejemplo":"Martín"},{"variable":"solicitante","ejemplo":"Ana Gómez"},{"variable":"email_solicitante","ejemplo":"ana@empresa.com"},{"variable":"empresa_nombre","ejemplo":"Transportes del Sur"},{"variable":"empresa_descripcion","ejemplo":"Flota de reparto"},{"variable":"link_aceptar","ejemplo":"https://app.smartlot.com/solicitud-registro/revision?solicitud=7&accion=aprobar"},{"variable":"link_rechazar","ejemplo":"https://app.smartlot.com/solicitud-registro/revision?solicitud=7&accion=rechazar"},{"variable":"link_panel","ejemplo":"https://app.smartlot.com/superadmin/gestion_usuarios"}]'::jsonb
),
(
  'solicitud_rechazada',
  'Solicitud de registro rechazada',
  'Notifica al solicitante que su solicitud de registro de empresa fue rechazada.',
  'Tu solicitud de registro fue rechazada - SmartLot',
  '<div style="background:linear-gradient(135deg, #0C1E3F 0%, #2A5CBF 100%);padding:40px 32px 36px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="margin:0 0 12px;"><span style="font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:900;font-size:28px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">Smart<span style="color:#6C93D6;">Lot</span></span></div>
    <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.02em;">El estacionamiento del futuro</p>
  </div>',
  '<div style="padding:36px 32px 32px;background-color:#FFFFFF;">
    <h2 style="margin:0 0 16px;font-family:''Archivo'', ''Segoe UI'', Arial, sans-serif;font-weight:800;font-size:22px;color:#1E293B;letter-spacing:-0.02em;">Hola, {{nombre}}</h2>
    <p style="margin:0 0 16px;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:15px;line-height:1.7;color:#334155;">
        Lamentablemente, tu solicitud de registro de la empresa <strong>{{empresa_nombre}}</strong> en SmartLot fue revisada y <strong>rechazada</strong>.
    </p>
    <div style="background:#FEF2F2;border-left:4px solid #DC2626;border-radius:10px;padding:18px 22px;margin:24px 0;">
        <p style="margin:0;font-family:''DM Sans'', ''Segoe UI'', Arial, sans-serif;font-size:14px;line-height:1.6;color:#7F1D1D;">
            Si creés que esto es un error o querés volver a postularte, comunicate con el equipo de SmartLot respondiendo a este correo.
        </p>
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
  '[{"variable":"nombre","ejemplo":"Ana Gómez"},{"variable":"empresa_nombre","ejemplo":"Transportes del Sur"},{"variable":"link_login","ejemplo":"https://app.smartlot.com/login"}]'::jsonb
)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;

import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import { MailtrapClient } from 'mailtrap';

const mailtrapClient = new MailtrapClient({
    token: (process.env.EMAIL_PASS || '').trim()
});

const ESTILOS_BASE = `
    body { margin: 0; padding: 0; background-color: #f4f7fa; font-family: 'Segoe UI', Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a73e8, #0d47a1); padding: 40px 30px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; }
    .header p { color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px; }
    .body { padding: 40px 30px; color: #333333; }
    .body h2 { color: #1a73e8; font-size: 20px; margin: 0 0 16px; }
    .body p { line-height: 1.7; margin: 0 0 16px; font-size: 15px; }
    .info-box { background: #f0f6ff; border-left: 4px solid #1a73e8; border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
    .info-box p { margin: 4px 0; font-size: 14px; color: #444; }
    .info-box strong { color: #1a73e8; }
    .footer { background: #f8f9fa; padding: 24px 30px; text-align: center; border-top: 1px solid #e9ecef; }
    .footer p { margin: 4px 0; font-size: 12px; color: #888888; }
    .btn { display: inline-block; padding: 12px 32px; background: #1a73e8; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 8px 0; }
    .alerta { background: #fff8e1; border-left: 4px solid #f9a825; }
    .alerta strong { color: #f57f17; }
`;

/**
 * Plantilla de bienvenida para nuevos usuarios
 */
export const plantillaBienvenida = (nombre, email) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="${ESTILOS_BASE.replace(/\n\s*/g, ' ')}">
    <div class="container">
        <div class="header">
            <h1>Bienvenido a SmartLot</h1>
            <p>Tu sistema inteligente de gestión de estacionamientos</p>
        </div>
        <div class="body">
            <h2>¡Hola, ${nombre}!</h2>
            <p>Tu cuenta ha sido creada exitosamente. Ya puedes iniciar sesión y comenzar a gestionar tus estacionamientos de forma inteligente.</p>
            <div class="info-box">
                <p><strong>📧 Correo:</strong> ${email}</p>
                <p><strong>🔑 Contraseña:</strong> La que registró la empresa al crear tu cuenta</p>
            </div>
            <p style="text-align:center;">
                <a href="${process.env.FRONTEND_URL || '#'}/login" class="btn">Iniciar Sesión</a>
            </p>
            <p style="font-size:14px;color:#888;text-align:center;">
                Por seguridad, no compartas tus credenciales con nadie.
            </p>
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} SmartLot — Todos los derechos reservados</p>
            <p>Este es un mensaje automático, por favor no respondas a este correo.</p>
        </div>
    </div>
</body>
</html>`;

/**
 * Plantilla de notificación de cambio de contraseña
 */
export const plantillaCambioContraseña = (nombre) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="${ESTILOS_BASE.replace(/\n\s*/g, ' ')}">
    <div class="container">
        <div class="header" style="background: linear-gradient(135deg, #f57f17, #e65100);">
            <h1>🔐 Contraseña Actualizada</h1>
            <p>Notificación de seguridad de tu cuenta</p>
        </div>
        <div class="body">
            <h2>Hola, ${nombre}</h2>
            <p>Te informamos que la contraseña de tu cuenta en <strong>SmartLot</strong> ha sido cambiada exitosamente.</p>
            <div class="info-box alerta">
                <p><strong>⚠️ ¿No solicitaste este cambio?</strong></p>
                <p>Si no realizaste esta acción, comunícate de inmediato con el administrador del sistema para proteger tu cuenta.</p>
            </div>
            <p style="text-align:center;">
                <a href="${process.env.FRONTEND_URL || '#'}/login" class="btn">Ir a SmartLot</a>
            </p>
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} SmartLot — Todos los derechos reservados</p>
            <p>Este es un mensaje automático, por favor no respondas a este correo.</p>
        </div>
    </div>
</body>
</html>`;

export const enviarCorreo = async (destinatario, asunto, contenidoHtml) => {
    try {
        const info = await mailtrapClient.send({
            from: {
                name: 'SmartLot Company',
                email: process.env.EMAIL_USER
            },
            to: [{ email: destinatario }],
            subject: asunto,
            html: contenidoHtml
        });
        if (!info.success) {
            const detalle = (info.errors || []).join(', ');
            throw new Error(detalle || 'La API de Mailtrap rechazó el envío.');
        }
        const messageId = Array.isArray(info.message_ids) && info.message_ids.length > 0
            ? info.message_ids[0]
            : 'n/a';
        console.log(`Correo enviado exitosamente a ${destinatario}. ID: ${messageId}`);
        return { success: true, messageId };
    } catch (error) {
        console.error('Error en el servicio de correos:', error);
        throw new Error('No se pudo enviar el correo.');
    }
};
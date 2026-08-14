import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import { MailtrapClient } from 'mailtrap';

const mailtrapClient = new MailtrapClient({
    token: (process.env.EMAIL_PASS || '').trim()
});

// ─── Marca SmartLot ───────────────────────────────────────────────
const BRAND = {
    navy: '#0C1E3F',
    navyAlt: '#2A5CBF',
    blue: '#2563EB',
    blueHover: '#156FE5',
    sky: '#6C93D6',
    bg: '#F5F7FB',
    surface: '#FFFFFF',
    text: '#1E293B',
    bodyText: '#334155',
    muted: '#64748B',
    border: '#E2E8F0',
    warning: '#EAB308',
    warningBg: '#FEFCE8',
    warningStrong: '#B45309'
};

const FONT_DISPLAY = "'Archivo', 'Segoe UI', Arial, sans-serif";
const FONT_BODY = "'DM Sans', 'Segoe UI', Arial, sans-serif";

const FRONTEND_URL = (process.env.FRONTEND_URL || '#').replace(/\/+$/, '');

// ─── Bloques reutilizables ────────────────────────────────────────
/**
 * Wordmark de SmartLot en texto (sin imágenes, compatible con todos los clientes).
 */
const wordmark = (tamanio = 28) => `
    <span style="font-family:${FONT_DISPLAY};font-weight:900;font-size:${tamanio}px;line-height:1;letter-spacing:-0.5px;color:#ffffff;">
        Smart<span style="color:${BRAND.sky};">Lot</span>
    </span>`;

/**
 * Header de marca: gradiente navy → azul con wordmark y tagline.
 */
const header = ({ tagline = 'El estacionamiento del futuro' } = {}) => `
    <div style="background:linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navyAlt} 100%);padding:40px 32px 36px;text-align:center;border-radius:16px 16px 0 0;">
        <div style="margin:0 0 12px;">${wordmark()}</div>
        <p style="margin:0;font-family:${FONT_BODY};font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.02em;">${tagline}</p>
    </div>`;

/**
 * Botón de CTA con los colores de marca.
 */
const boton = (href, texto) => `
    <a href="${href}" style="display:inline-block;padding:14px 42px;background-color:${BRAND.blue};color:#ffffff;text-decoration:none;border-radius:10px;font-family:${FONT_BODY};font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(37,99,235,0.30);">${texto}</a>`;

/**
 * Caja de información: variante 'info' (azul) o 'alerta' (ámbar).
 * lineas: array de pares [etiqueta, valor]; si la etiqueta es vacía se renderiza solo el valor.
 */
const cajaInfo = ({ titulo = '', lineas = [], variante = 'info' } = {}) => {
    const esAlerta = variante === 'alerta';
    const fondo = esAlerta ? BRAND.warningBg : '#EFF6FF';
    const borde = esAlerta ? BRAND.warning : BRAND.blue;
    const acento = esAlerta ? BRAND.warningStrong : BRAND.blue;
    const colorTexto = esAlerta ? '#7C5E10' : '#3B4A63';

    const cuerpo = lineas.map(([label, valor]) => label
        ? `<p style="margin:6px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${colorTexto};"><strong style="color:${acento};">${label}:</strong> ${valor}</p>`
        : `<p style="margin:6px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${colorTexto};">${valor}</p>`
    ).join('');

    return `
    <div style="background:${fondo};border-left:4px solid ${borde};border-radius:10px;padding:18px 22px;margin:24px 0;">
        ${titulo ? `<p style="margin:0 0 8px;font-family:${FONT_DISPLAY};font-weight:700;font-size:14px;color:${acento};">${titulo}</p>` : ''}
        ${cuerpo}
    </div>`;
};

/**
 * Footer de marca: fondo navy con wordmark y legal.
 */
const footer = () => `
    <div style="background:${BRAND.navy};padding:26px 32px;text-align:center;border-radius:0 0 16px 16px;">
        <div style="margin:0 0 10px;">${wordmark(16)}</div>
        <p style="margin:0;font-family:${FONT_BODY};font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">
            © ${new Date().getFullYear()} SmartLot — Todos los derechos reservados<br>
            Este es un mensaje automático, por favor no respondas a este correo.
        </p>
    </div>`;

/**
 * Layout base: envuelve el cuerpo en el documento HTML completo con header y footer de marca.
 */
const layout = (cuerpo) => `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SmartLot</title>
    <style>
        body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        @media only screen and (max-width: 620px) {
            .contenedor { padding: 12px 8px !important; }
        }
    </style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};">
    <div class="contenedor" style="max-width:600px;margin:0 auto;padding:24px 16px;background-color:${BRAND.bg};">
        <div style="background-color:${BRAND.surface};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.border};box-shadow:0 8px 30px rgba(12,30,63,0.10);">
            ${header()}
            ${cuerpo}
            ${footer()}
        </div>
    </div>
</body>
</html>`;

// ─── Plantillas ───────────────────────────────────────────────────
/**
 * Plantilla de bienvenida para nuevos usuarios.
 */
export const plantillaBienvenida = (nombre, email) => {
    const cuerpo = `
    <div style="padding:36px 32px 32px;background-color:${BRAND.surface};">
        <h2 style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-weight:800;font-size:22px;color:${BRAND.text};letter-spacing:-0.02em;">¡Hola, ${nombre}!</h2>
        <p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.bodyText};">
            Tu cuenta en <strong>SmartLot</strong> fue creada exitosamente. Ya podés iniciar sesión y comenzar a gestionar tus estacionamientos de forma inteligente.
        </p>
        ${cajaInfo({ lineas: [
            ['Correo', email],
            ['Contraseña', 'La que registró la empresa al crear tu cuenta']
        ] })}
        <p style="text-align:center;margin:28px 0 8px;">${boton(`${FRONTEND_URL}/login`, 'Iniciar Sesión')}</p>
        <p style="margin:12px 0 0;font-family:${FONT_BODY};font-size:13px;color:${BRAND.muted};text-align:center;">Por seguridad, no compartas tus credenciales con nadie.</p>
    </div>`;

    return layout(cuerpo);
};

/**
 * Plantilla de notificación de cambio de contraseña.
 */
export const plantillaCambioContraseña = (nombre) => {
    const cuerpo = `
    <div style="padding:36px 32px 32px;background-color:${BRAND.surface};">
        <h2 style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-weight:800;font-size:22px;color:${BRAND.text};letter-spacing:-0.02em;">Hola, ${nombre}</h2>
        <p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.bodyText};">
            Te informamos que la contraseña de tu cuenta en <strong>SmartLot</strong> fue cambiada exitosamente.
        </p>
        ${cajaInfo({
            titulo: '¿No solicitaste este cambio?',
            lineas: [['', 'Si no realizaste esta acción, comunicate de inmediato con el administrador del sistema para proteger tu cuenta.']],
            variante: 'alerta'
        })}
        <p style="text-align:center;margin:28px 0 8px;">${boton(`${FRONTEND_URL}/login`, 'Ir a SmartLot')}</p>
    </div>`;

    return layout(cuerpo);
};

// ─── Envío ────────────────────────────────────────────────────────
export const enviarCorreo = async (destinatario, asunto, contenidoHtml) => {
    try {
        const info = await mailtrapClient.send({
            from: {
                name: 'SmartLot',
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

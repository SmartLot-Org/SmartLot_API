import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import https from 'node:https';
import { MailtrapClient } from 'mailtrap';
import { pool } from '../database/dbClient.js';

const mailtrapClient = new MailtrapClient({
    token: (process.env.EMAIL_PASS || '').trim()
});

/**
 * Resuelve el agente HTTPS para la API de Mailtrap.
 * La red local puede interceptar TLS con certificados autofirmados
 * (SELF_SIGNED_CERT_IN_CHAIN, mismo caso que el pooler de Supabase en database/db.js).
 * - EMAIL_CA_CERT: validación estricta con CA personalizada (PEM, admite \n escapados).
 * - Fuera de producción: validación relajada.
 * - En producción sin CA: null (agente estricto por defecto del SDK).
 */
export const resolveMailtrapHttpsAgent = () => {
    if (process.env.EMAIL_CA_CERT) {
        return new https.Agent({
            keepAlive: true,
            ca: process.env.EMAIL_CA_CERT.replace(/\\n/g, '\n'),
            rejectUnauthorized: true,
        });
    }
    if (process.env.NODE_ENV !== 'production') {
        return new https.Agent({ keepAlive: true, rejectUnauthorized: false });
    }
    return null;
};

const mailtrapHttpsAgent = resolveMailtrapHttpsAgent();
if (mailtrapHttpsAgent && mailtrapClient.axios?.defaults) {
    mailtrapClient.axios.defaults.httpsAgent = mailtrapHttpsAgent;
}

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
 * Header de marca por defecto: gradiente navy → azul con wordmark y tagline.
 */
const header = ({ tagline = 'El estacionamiento del futuro' } = {}) => `
    <div style="background:linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navyAlt} 100%);padding:40px 32px 36px;text-align:center;border-radius:16px 16px 0 0;">
        <div style="margin:0 0 12px;">${wordmark()}</div>
        <p style="margin:0;font-family:${FONT_BODY};font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.02em;">${tagline}</p>
    </div>`;

/**
 * Botón de CTA con los colores de marca.
 * colorFondo: hex opcional (ej. verde para aceptar, rojo para rechazar); por defecto azul de marca.
 */
const boton = (href, texto, colorFondo = BRAND.blue) => `
    <a href="${href}" style="display:inline-block;padding:14px 42px;background-color:${colorFondo};color:#ffffff;text-decoration:none;border-radius:10px;font-family:${FONT_BODY};font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(37,99,235,0.30);">${texto}</a>`;

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
 * Footer de marca por defecto: fondo navy con wordmark y legal.
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
 * Layout base: envuelve las secciones en el documento HTML completo.
 * Si no se pasan header/footer usa los bloques de marca por defecto.
 */
const layout = (cuerpo, headerHtml = header(), footerHtml = footer()) => `
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
            ${headerHtml}
            ${cuerpo}
            ${footerHtml}
        </div>
    </div>
</body>
</html>`;

// ─── Plantillas de respaldo (se usan si la base de datos falla) ───
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

/**
 * Plantilla de recuperación de contraseña (código de verificación).
 */
export const plantillaRecuperoContraseña = (nombre, codigo) => {
    const cuerpo = `
    <div style="padding:36px 32px 32px;background-color:${BRAND.surface};">
        <h2 style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-weight:800;font-size:22px;color:${BRAND.text};letter-spacing:-0.02em;">Hola, ${nombre}</h2>
        <p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.bodyText};">
            Recibiste este correo porque solicitaste restablecer tu contraseña en <strong>SmartLot</strong>.
        </p>
        <p style="margin:0 0 24px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.bodyText};">
            Tu código de verificación es:
        </p>
        <div style="background:${BRAND.bg};border:2px dashed ${BRAND.blue};border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
            <span style="font-family:'Courier New', monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND.navy};">${codigo}</span>
        </div>
        <p style="margin:0 0 8px;font-family:${FONT_BODY};font-size:13px;color:${BRAND.muted};text-align:center;">
            Este código expira en <strong>10 minutos</strong>. No lo compartas con nadie.
        </p>
        ${cajaInfo({
            titulo: '¿No solicitaste este cambio?',
            lineas: [['', 'Si no solicitaste restablecer tu contraseña, puedes ignorar este correo. Tu cuenta permanece segura.']],
            variante: 'alerta'
        })}
        <p style="text-align:center;margin:28px 0 8px;">${boton(`${FRONTEND_URL}/login`, 'Ir a SmartLot')}</p>
    </div>`;

    return layout(cuerpo);
};

/**
 * Plantilla para superadmins: nueva solicitud de registro de empresa
 * con botones de Aceptar / Rechazar que llevan a la página de confirmación
 * del frontend (donde se exige sesión de superadmin).
 */
export const plantillaSolicitudRegistroSuperadmin = (v = {}) => {
    const solicitante = v.solicitante ?? '';
    const cuerpo = `
    <div style="padding:36px 32px 32px;background-color:${BRAND.surface};">
        <h2 style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-weight:800;font-size:22px;color:${BRAND.text};letter-spacing:-0.02em;">Hola, ${v.nombre_superadmin ?? ''}</h2>
        <p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.bodyText};">
            <strong>${solicitante}</strong> quiere registrar la empresa <strong>${v.empresa_nombre ?? ''}</strong> en SmartLot.
        </p>
        ${cajaInfo({ lineas: [
            ['Solicitante', `${solicitante} (${v.email_solicitante ?? ''})`],
            ['Empresa', v.empresa_nombre ?? ''],
            ['Descripción', v.empresa_descripcion ?? '—']
        ] })}
        <p style="margin:24px 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.bodyText};">
            Revisá los datos y confirmá tu decisión: se te pedirá iniciar sesión como superadmin.
        </p>
        <p style="text-align:center;margin:28px 0 8px;">
            ${boton(v.link_aceptar ?? FRONTEND_URL, 'Aceptar solicitud', '#16A34A')}
            <span style="display:inline-block;width:12px;"></span>
            ${boton(v.link_rechazar ?? FRONTEND_URL, 'Rechazar', '#DC2626')}
        </p>
        <p style="text-align:center;margin:20px 0 0;">
            <a href="${v.link_panel ?? FRONTEND_URL}" style="color:${BRAND.blue};font-family:${FONT_BODY};font-size:13px;">Ver todas las solicitudes en el panel</a>
        </p>
        <p style="margin:12px 0 0;font-family:${FONT_BODY};font-size:13px;color:${BRAND.muted};text-align:center;">Por seguridad, la acción se confirma en SmartLot con tu sesión de superadmin.</p>
    </div>`;

    return layout(cuerpo);
};

/**
 * Plantilla de rechazo de solicitud de registro para el solicitante.
 */
export const plantillaSolicitudRechazada = (nombre, empresaNombre) => {
    const cuerpo = `
    <div style="padding:36px 32px 32px;background-color:${BRAND.surface};">
        <h2 style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-weight:800;font-size:22px;color:${BRAND.text};letter-spacing:-0.02em;">Hola, ${nombre}</h2>
        <p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.bodyText};">
            Lamentablemente, tu solicitud de registro de la empresa <strong>${empresaNombre}</strong> en SmartLot fue revisada y <strong>rechazada</strong>.
        </p>
        ${cajaInfo({
            lineas: [['', 'Si creés que esto es un error o querés volver a postularte, comunicate con el equipo de SmartLot respondiendo a este correo.']],
            variante: 'alerta'
        })}
        <p style="text-align:center;margin:28px 0 8px;">${boton(`${FRONTEND_URL}/login`, 'Ir a SmartLot')}</p>
    </div>`;

    return layout(cuerpo);
};

// ─── Plantillas desde base de datos ───────────────────────────────
const TPL_CACHE_TTL_MS = 60 * 1000;
const tplCache = new Map();

/**
 * Escapa un valor para insertarlo de forma segura dentro del HTML del correo.
 */
export const escaparHtml = (valor) => String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * Invalida la caché de una plantilla (o de todas si no se pasa codigo).
 */
export const invalidarCachePlantilla = (codigo) => {
    if (codigo) tplCache.delete(codigo);
    else tplCache.clear();
};

/**
 * Carga una plantilla desde la tabla email_templates con caché en memoria.
 * Devuelve null si no existe o si la base de datos falla.
 */
export const cargarPlantilla = async (codigo) => {
    const enCache = tplCache.get(codigo);
    if (enCache && Date.now() - enCache.ts < TPL_CACHE_TTL_MS) {
        return enCache.plantilla;
    }

    try {
        const { rows } = await pool.query(
            `SELECT * FROM email_templates WHERE codigo = $1 AND activa = true`,
            [codigo]
        );
        const plantilla = rows[0] ?? null;
        if (plantilla) tplCache.set(codigo, { ts: Date.now(), plantilla });
        return plantilla;
    } catch (error) {
        console.error('Error cargando plantilla de email:', error);
        return null;
    }
};

/**
 * Variables construidas automáticamente por el sistema (no editables desde el backoffice).
 */
const construirVariablesBase = (variables = {}) => ({
    link_login: `${FRONTEND_URL}/login`,
    anio: String(new Date().getFullYear()),
    ...variables
});

/**
 * Renderiza una plantilla de la DB: reemplaza los placeholders {{variable}}
 * por los valores recibidos (escapados en HTML). Las variables desconocidas
 * quedan intactas para detectar faltantes en el preview.
 */
export const renderPlantilla = (plantilla, variables = {}) => {
    const mapa = construirVariablesBase(variables);

    const reemplazar = (texto) => String(texto ?? '').replace(
        /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
        (match, nombreVar) => Object.prototype.hasOwnProperty.call(mapa, nombreVar)
            ? escaparHtml(mapa[nombreVar])
            : match
    );

    return {
        asunto: reemplazar(plantilla.asunto),
        html: reemplazar(layout(plantilla.cuerpo_html, plantilla.header_html, plantilla.footer_html))
    };
};

const FALLBACKS = {
    bienvenida: (v = {}) => ({
        asunto: 'Bienvenido a SmartLot',
        html: plantillaBienvenida(v.nombre ?? '', v.email ?? '')
    }),
    cambio_contraseña: (v = {}) => ({
        asunto: 'Contraseña Actualizada - SmartLot',
        html: plantillaCambioContraseña(v.nombre ?? '')
    }),
    recuperar_contraseña: (v = {}) => ({
        asunto: 'Código de Verificación - SmartLot',
        html: plantillaRecuperoContraseña(v.nombre ?? '', v.codigo ?? '')
    }),
    solicitud_registro_superadmin: (v = {}) => ({
        asunto: 'Nueva solicitud de registro - SmartLot',
        html: plantillaSolicitudRegistroSuperadmin(v)
    }),
    solicitud_rechazada: (v = {}) => ({
        asunto: 'Tu solicitud de registro fue rechazada - SmartLot',
        html: plantillaSolicitudRechazada(v.nombre ?? '', v.empresa_nombre ?? '')
    })
};

/**
 * Envía un correo usando una plantilla guardada en la base de datos.
 * Si la plantilla no existe o la DB falla, usa la plantilla de respaldo en código.
 */
export const enviarCorreoDesdePlantilla = async (destinatario, codigo, variables = {}) => {
    const plantilla = await cargarPlantilla(codigo);

    let asunto;
    let html;
    if (plantilla) {
        ({ asunto, html } = renderPlantilla(plantilla, variables));
    } else {
        const fallback = FALLBACKS[codigo];
        if (!fallback) throw new Error(`No existe la plantilla de correo "${codigo}".`);
        ({ asunto, html } = fallback(variables));
    }

    return await enviarCorreo(destinatario, asunto, html);
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
        // Se registra solo código y mensaje: el objeto completo de axios puede
        // incluir headers con el token de la API de Mailtrap.
        const codigo = error?.code || error?.response?.status || 'desconocido';
        console.error(`Error en el servicio de correos [${codigo}]:`, error?.message || error);
        throw new Error('No se pudo enviar el correo.');
    }
};
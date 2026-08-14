/**
 * send-emails.cjs
 * Envía todas las plantillas de email de SmartLot a un destinatario de prueba
 * para validar el diseño y la entrega vía Mailtrap.
 *
 * Uso: node scripts/send-emails.cjs <email>
 *      (si no se pasa email, usa el de prueba por defecto)
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { setDefaultResultOrder } = require('dns');
setDefaultResultOrder('ipv4first');

async function run() {
    const errors = [];
    const warnings = [];
    const details = {};

    const emailTo = process.argv[2] || '49123639@est.ort.edu.ar';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
        errors.push(`Email inválido: ${emailTo}`);
        return { errors, warnings, details };
    }

    const emailServiceUrl = pathToFileURL(
        path.join(__dirname, '..', 'src', 'services', 'emailService.js')
    ).href;

    const { plantillaBienvenida, plantillaCambioContraseña, enviarCorreo } =
        await import(emailServiceUrl);

    const envios = [
        {
            asunto: 'Bienvenido a SmartLot',
            html: plantillaBienvenida('Usuario de Prueba', emailTo)
        },
        {
            asunto: 'Contraseña Actualizada - SmartLot',
            html: plantillaCambioContraseña('Usuario de Prueba')
        }
    ];

    details.destinatario = emailTo;
    details.cantidad = envios.length;

    for (const envio of envios) {
        try {
            const resultado = await enviarCorreo(emailTo, envio.asunto, envio.html);
            details[envio.asunto] = `OK (${resultado.messageId})`;
        } catch (err) {
            errors.push(`${envio.asunto}: ${err.message}`);
        }
    }

    return { errors, warnings, details };
}

if (require.main === module) {
    const { COLORS } = require('./_cli-helper.cjs');
    try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

    (async () => {
        const result = await run();

        console.log('');
        console.log(`${COLORS.bold}${COLORS.cyan}═══ Emails de prueba SmartLot ═══${COLORS.reset}`);
        console.log('');
        const ec = result.errors.length, wc = result.warnings.length;
        if (ec === 0 && wc === 0) console.log(`  ${COLORS.green}OK${COLORS.reset}`);
        else if (ec === 0) console.log(`  ${COLORS.yellow}OK con advertencias${COLORS.reset}`);
        else console.log(`  ${COLORS.red}FALLÓ${COLORS.reset}`);
        for (const e of result.errors) console.log(`  ${COLORS.red}✗ ${e}${COLORS.reset}`);
        for (const w of result.warnings) console.log(`  ${COLORS.yellow}⚠ ${w}${COLORS.reset}`);
        if (result.details) {
            for (const [k, v] of Object.entries(result.details)) {
                const display = Array.isArray(v) ? v.join(', ') : v;
                console.log(`  ${COLORS.dim}${k}: ${display}${COLORS.reset}`);
            }
        }
        console.log('');
        process.exit(ec > 0 ? 1 : 0);
    })();
}

module.exports = { run };
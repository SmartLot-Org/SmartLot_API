/**
 * check_nodemailer.cjs
 * Verifica el envío de correos vía la API de Mailtrap (HTTPS/443) y envía
 * un correo de prueba a contact@smartlot.ar para confirmar que la cuenta
 * funciona con el nuevo dominio y que la API key (EMAIL_PASS) es válida.
 */
const path = require('path');
const { setDefaultResultOrder } = require('dns');
setDefaultResultOrder('ipv4first');

const { MailtrapClient } = require('mailtrap');

async function run() {
    const errors = [];
    const warnings = [];
    const details = {};

    const user = process.env.EMAIL_USER;
    const pass = (process.env.EMAIL_PASS || '').trim();
    const emailTo = "adrian.turek@ort.edu.ar";

    if (!user) {
        errors.push('EMAIL_USER no está definida en las variables de entorno');
    }
    if (!pass) {
        errors.push('EMAIL_PASS no está definida en las variables de entorno');
    }
    if (errors.length > 0) {
        return { errors, warnings, details };
    }

    details.user = user;
    if (!/@smartlot\.ar$/i.test(user)) {
        warnings.push(`EMAIL_USER no pertenece al dominio @smartlot.ar (actual: ${user})`);
    }

    const client = new MailtrapClient({ token: pass });

    try {
        const info = await client.send({
            from: { name: 'SmartLot', email: user },
            to: [{ email: emailTo }],
            subject: 'SmartLot — Info de las Compus',
            html: `
                <h1 style="font-family:Segoe UI,Arial,sans-serif;color:#1a73e8;margin-bottom:24px;">
                    Info de las Compus
                </h1>
                <ul style="font-family:Segoe UI,Arial,sans-serif;list-style:none;padding:0;margin:0 0 24px;">
                    <li style="background:#f0f6ff;border-left:4px solid #1a73e8;border-radius:8px;padding:16px 20px;margin:0 0 12px;">
                        <strong style="color:#1a73e8;font-size:16px;">TOBI</strong>
                        <p style="margin:6px 0 0;font-size:14px;color:#444;">
                            <strong>IP:</strong> 10.152.2.138 &nbsp;•&nbsp; <strong>COMPU:</strong> A-PHZ2-CIDI-50
                        </p>
                    </li>
                    <li style="background:#f0f6ff;border-left:4px solid #1a73e8;border-radius:8px;padding:16px 20px;margin:0 0 12px;">
                        <strong style="color:#1a73e8;font-size:16px;">AUGUSTO</strong>
                        <p style="margin:6px 0 0;font-size:14px;color:#444;">
                            <strong>IP:</strong> 10.152.2.137 &nbsp;•&nbsp; <strong>COMPU:</strong> A-PHZ2-CIDI-52
                        </p>
                    </li>
                    <li style="background:#f0f6ff;border-left:4px solid #1a73e8;border-radius:8px;padding:16px 20px;margin:0 0 12px;">
                        <strong style="color:#1a73e8;font-size:16px;">FRANCO C</strong>
                        <p style="margin:6px 0 0;font-size:14px;color:#444;">
                            <strong>IP:</strong> 10.152.2.142 &nbsp;•&nbsp; <strong>COMPU:</strong> A-PHZ2-CIDI-51
                        </p>
                    </li>
                    <li style="background:#f0f6ff;border-left:4px solid #1a73e8;border-radius:8px;padding:16px 20px;margin:0 0 12px;">
                        <strong style="color:#1a73e8;font-size:16px;">FRANCO U &amp; FACU</strong>
                        <p style="margin:6px 0 0;font-size:14px;color:#444;">
                            <strong>IP:</strong> 10.152.2.139 &nbsp;•&nbsp; <strong>COMPU:</strong> A-PHZ2-CIDI-49
                        </p>
                    </li>
                </ul>
                <p style="font-family:Segoe UI,Arial,sans-serif;color:#333;">
                    Si estás leyendo esto en <strong>${user}</strong>,
                    la API token (EMAIL_PASS) es válida y el dominio
                    <strong>smartlot.ar</strong> está autorizado como remitente.
                </p>
                <p style="font-family:Segoe UI,Arial,sans-serif;color:#888;font-size:12px;">
                    Mensaje generado automáticamente por <code>scripts/check_nodemailer.cjs</code>.
                </p>
            `,
        });
        details.success = info.success;
        details.messageIds = Array.isArray(info.message_ids) ? info.message_ids.join(', ') : 'n/a';
    } catch (err) {
        errors.push(`Falló client.send(): ${err.message}`);
    }

    return { errors, warnings, details };
}

module.exports = { run };

if (require.main === module) {
    (async () => {
        const { COLORS } = require('./_cli-helper.cjs');
        try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

        const result = await run();

        console.log('');
        console.log(`${COLORS.bold}${COLORS.cyan}═══ Nodemailer / Mailtrap API ═══${COLORS.reset}`);
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
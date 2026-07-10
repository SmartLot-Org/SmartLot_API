/**
 * check-port.js
 * Verifica que el puerto configurado no esté en uso por otro proceso.
 */
const net = require('net');

function run() {
    const errors = [];
    const warnings = [];
    const details = {};

    const port = parseInt(process.env.PORT || '3000', 10);
    details.port = port;

    if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(`Puerto inválido: ${process.env.PORT}`);
        return { errors, warnings, details };
    }

    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                errors.push(`Puerto ${port} ya está en uso por otro proceso`);
            } else {
                errors.push(`Error al verificar puerto ${port}: ${err.message}`);
            }
            resolve({ errors, warnings, details });
        });

        server.listen(port, '127.0.0.1', () => {
            server.close(() => {
                details.available = true;
                resolve({ errors, warnings, details });
            });
        });
    });
}

module.exports = { run };

if (require.main === module) {
    (async () => {
        const path = require('path');
        try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

        const start = Date.now();
        let result;
        try { result = await run(); } catch (err) {
            result = { errors: [`Excepción: ${err.message}`], warnings: [] };
        }
        const duration = Date.now() - start;

        const C = require('./_cli-helper.cjs').COLORS;
        console.log('');
        console.log(`${C.bold}${C.cyan}═══ Puerto disponible ═══${C.reset}`);
        console.log('');
        const ec = result.errors.length, wc = result.warnings.length;
        if (ec === 0 && wc === 0) console.log(`  ${C.green}OK${C.reset} (${duration}ms)`);
        else if (ec === 0) console.log(`  ${C.yellow}OK con advertencias${C.reset} (${duration}ms)`);
        else console.log(`  ${C.red}FALLÓ${C.reset} (${duration}ms)`);
        for (const e of result.errors) console.log(`  ${C.red}✗ ${e}${C.reset}`);
        for (const w of result.warnings) console.log(`  ${C.yellow}⚠ ${w}${C.reset}`);
        if (result.details) {
            for (const [k, v] of Object.entries(result.details)) {
                console.log(`  ${C.dim}${k}: ${Array.isArray(v) ? v.join(', ') : v}${C.reset}`);
            }
        }
        console.log('');
        process.exit(ec > 0 ? 1 : 0);
    })();
}

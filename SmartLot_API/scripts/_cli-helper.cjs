/**
 * _cli-helper.cjs
 * Funciones compartidas para ejecutar scripts de check individualmente desde la CLI.
 */
const path = require('path');

const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};

function runStandalone(name, runFn) {
    const rootDir = path.join(__dirname, '..');
    try { require('dotenv').config({ path: path.join(rootDir, '.env') }); } catch {}

    const start = Date.now();
    let result;
    try {
        result = runFn();
    } catch (err) {
        result = { errors: [`Excepción: ${err.message}`], warnings: [] };
    }
    const duration = Date.now() - start;

    const errorCount = result.errors.length;
    const warnCount = result.warnings.length;

    console.log('');
    console.log(`${COLORS.bold}${COLORS.cyan}═══ ${name} ═══${COLORS.reset}`);
    console.log('');

    if (errorCount === 0 && warnCount === 0) {
        console.log(`  ${COLORS.green}OK${COLORS.reset} (${duration}ms)`);
    } else if (errorCount === 0) {
        console.log(`  ${COLORS.yellow}OK con advertencias${COLORS.reset} (${duration}ms)`);
    } else {
        console.log(`  ${COLORS.red}FALLÓ${COLORS.reset} (${duration}ms)`);
    }

    for (const err of result.errors) {
        console.log(`  ${COLORS.red}✗ ${err}${COLORS.reset}`);
    }
    for (const warn of result.warnings) {
        console.log(`  ${COLORS.yellow}⚠ ${warn}${COLORS.reset}`);
    }
    if (result.details) {
        for (const [key, val] of Object.entries(result.details)) {
            const display = Array.isArray(val) ? val.join(', ') : val;
            console.log(`  ${COLORS.dim}${key}: ${display}${COLORS.reset}`);
        }
    }

    console.log('');
    process.exit(errorCount > 0 ? 1 : 0);
}

module.exports = { runStandalone, COLORS };

/**
 * pre-deploy.js
 * Orquestador principal de checks pre-deploy.
 * Ejecuta todos los scripts de verificación y genera un reporte consolidado.
 *
 * Uso: node scripts/pre-deploy.js [--env-file .env]
 */
const { run: checkEnv } = require('./check-env.cjs');
const { run: checkSyntax } = require('./check-syntax.cjs');
const { run: checkDeps } = require('./check-deps.cjs');
const { run: checkSecurity } = require('./check-security.cjs');
const { run: checkStructure } = require('./check-structure.cjs');
const { run: checkRoutes } = require('./check-routes.cjs');
const { run: checkDb } = require('./check-db.cjs');
const { run: checkPort } = require('./check-port.cjs');

const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};

const CHECKS = [
    { name: 'Variables de entorno', fn: checkEnv, sync: true },
    { name: 'Sintaxis JavaScript', fn: checkSyntax, sync: true },
    { name: 'Dependencias', fn: checkDeps, sync: true },
    { name: 'Seguridad', fn: checkSecurity, sync: true },
    { name: 'Estructura del proyecto', fn: checkStructure, sync: true },
    { name: 'Rutas Express', fn: checkRoutes, sync: true },
    { name: 'Puerto disponible', fn: checkPort, sync: false },
    { name: 'Conexión a base de datos', fn: checkDb, sync: false },
];

function printHeader() {
    console.log('');
    console.log(`${COLORS.bold}${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}   PRE-DEPLOY CHECK - SmartLot API${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.dim}   Fecha: ${new Date().toISOString()}${COLORS.reset}`);
    console.log(`${COLORS.dim}   Entorno: ${process.env.NODE_ENV || 'development'}${COLORS.reset}`);
    console.log('');
}

function printCheckResult(name, result, duration) {
    const errorCount = result.errors.length;
    const warnCount = result.warnings.length;

    let status;
    if (errorCount > 0) {
        status = `${COLORS.red}FALLÓ${COLORS.reset}`;
    } else if (warnCount > 0) {
        status = `${COLORS.yellow}OK (con advertencias)${COLORS.reset}`;
    } else {
        status = `${COLORS.green}OK${COLORS.reset}`;
    }

    console.log(`  ${COLORS.bold}${name}${COLORS.reset} — ${status} ${COLORS.dim}(${duration}ms)${COLORS.reset}`);

    for (const err of result.errors) {
        console.log(`    ${COLORS.red}✗ ${err}${COLORS.reset}`);
    }
    for (const warn of result.warnings) {
        console.log(`    ${COLORS.yellow}⚠ ${warn}${COLORS.reset}`);
    }
    if (result.details) {
        for (const [key, val] of Object.entries(result.details)) {
            if (Array.isArray(val)) {
                console.log(`    ${COLORS.dim}${key}: ${val.join(', ')}${COLORS.reset}`);
            } else {
                console.log(`    ${COLORS.dim}${key}: ${val}${COLORS.reset}`);
            }
        }
    }
}

async function runCheck(check) {
    const start = Date.now();
    let result;
    try {
        if (check.sync) {
            result = check.fn();
        } else {
            result = await check.fn();
        }
    } catch (err) {
        result = {
            errors: [`Excepción no manejada: ${err.message}`],
            warnings: [],
            details: { stack: err.stack },
        };
    }
    const duration = Date.now() - start;
    return { result, duration };
}

async function main() {
    printHeader();

    const envFileArg = process.argv.indexOf('--env-file');
    if (envFileArg !== -1 && process.argv[envFileArg + 1]) {
        require('dotenv').config({ path: process.argv[envFileArg + 1] });
    } else {
        require('dotenv').config();
    }

    let totalErrors = 0;
    let totalWarnings = 0;

    for (const check of CHECKS) {
        const { result, duration } = await runCheck(check);
        printCheckResult(check.name, result, duration);
        totalErrors += result.errors.length;
        totalWarnings += result.warnings.length;
    }

    console.log('');
    console.log(`${COLORS.bold}${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.bold}   RESUMEN${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);

    if (totalErrors === 0 && totalWarnings === 0) {
        console.log(`  ${COLORS.green}${COLORS.bold}✓ TODOS LOS CHECKS PASARON - Listo para deploy${COLORS.reset}`);
    } else if (totalErrors === 0) {
        console.log(`  ${COLORS.yellow}${COLORS.bold}⚠ SIN ERRORES (${totalWarnings} advertencias) - Deployable con precaución${COLORS.reset}`);
    } else {
        console.log(`  ${COLORS.red}${COLORS.bold}✗ ${totalErrors} ERROR(ES) ENCONTRADOS - NO DEPLOYAR${COLORS.reset}`);
        if (totalWarnings > 0) {
            console.log(`  ${COLORS.yellow}  + ${totalWarnings} advertencia(s)${COLORS.reset}`);
        }
    }

    console.log(`${COLORS.bold}${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
    console.log('');

    process.exit(totalErrors > 0 ? 1 : 0);
}

main();

/**
 * check-routes.js
 * Valida que app.js registre todas las rutas esperadas y que cada controller exista.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_FILE = path.join(ROOT, 'src', 'app.js');

const EXPECTED_ROUTES = [
    '/api/empresa',
    '/api/garage',
    '/api/marca',
    '/api/modelo',
    '/api/reserva',
    '/api/rol',
    '/api/sede',
    '/api/usuario',
    '/api/vehiculo',
    '/api/auth',
    '/api/conflicto',
];

function run() {
    const errors = [];
    const warnings = [];

    if (!fs.existsSync(APP_FILE)) {
        errors.push('No se encontró src/app.js');
        return { errors, warnings };
    }

    const appContent = fs.readFileSync(APP_FILE, 'utf-8');

    for (const route of EXPECTED_ROUTES) {
        const routeRegex = new RegExp(`app\\.use\\s*\\(\\s*['"]${escapeRegex(route)}['"]`);
        if (!routeRegex.test(appContent)) {
            errors.push(`Ruta no registrada en app.js: ${route}`);
        }
    }

    const importRegex = /import\s+(\w+)\s+from\s+['"](.+?)['"]/g;
    let match;
    const imports = [];
    while ((match = importRegex.exec(appContent)) !== null) {
        imports.push({ name: match[1], path: match[2] });
    }

    const importPathsUsed = appContent.match(/from\s+['"](.+?)['"]/g) || [];

    for (const imp of imports) {
        if (imp.path.startsWith('.')) {
            const resolved = path.resolve(path.join(ROOT, 'src'), imp.path);
            if (!fs.existsSync(resolved) && !fs.existsSync(resolved + '.js')) {
                errors.push(`Import roto en app.js: ${imp.path} (referencia: ${imp.name})`);
            }
        }
    }

    const hasHelmet = /helmet/.test(appContent);
    const hasCors = /cors/.test(appContent);
    const hasErrorHandler = /errorHandler/.test(appContent);
    const hasAuth = /authMiddleware/.test(appContent);

    if (!hasHelmet) warnings.push('app.js no usa helmet (seguridad HTTP)');
    if (!hasCors) warnings.push('app.js no configura CORS');
    if (!hasErrorHandler) warnings.push('app.js no tiene errorHandler registrado');
    if (!hasAuth) warnings.push('app.js no usa authMiddleware');

    if (!appContent.includes('express.json')) {
        warnings.push('app.js no parsea JSON (falta express.json())');
    }

    return { errors, warnings };
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { run };

if (require.main === module) {
    const { runStandalone } = require('./_cli-helper.cjs');
    runStandalone('Rutas Express', run);
}

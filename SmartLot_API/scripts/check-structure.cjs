/**
 * check-structure.js
 * Valida que la arquitectura del proyecto esté completa:
 * - Cada controller tiene su service correspondiente
 * - Cada service tiene su repository correspondiente
 * - No hay imports rotos (referencias a archivos que no existen)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const ENTITY_NAMES = [
    'empresa', 'garage', 'marca', 'modelo', 'reserva',
    'rol', 'sede', 'usuario', 'vehiculo', 'conflicto',
];

const ROUTE_SEGMENTS = [
    'empresa', 'garage', 'marca', 'modelo', 'reserva',
    'rol', 'sede', 'usuario', 'vehiculo', 'conflicto', 'auth',
];

function exists(filePath) {
    return fs.existsSync(filePath);
}

function run() {
    const errors = [];
    const warnings = [];

    for (const name of ENTITY_NAMES) {
        const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
        const variants = [
            { type: 'Entity',    dir: 'entities',      file: `${capitalizedName}.js` },
            { type: 'Repository', dir: 'repositories', file: `${name}Repository.js` },
            { type: 'Service',   dir: 'services',      file: `${name}Service.js` },
            { type: 'Controller', dir: 'controllers',  file: `${name}Controller.js` },
        ];

        for (const v of variants) {
            const fp = path.join(SRC_DIR, v.dir, v.file);
            if (!exists(fp)) {
                warnings.push(`Falta ${v.type}: src/${v.dir}/${v.file}`);
            }
        }
    }

    const controllersDir = path.join(SRC_DIR, 'controllers');
    if (exists(controllersDir)) {
        const controllers = fs.readdirSync(controllersDir).filter(f => f.endsWith('.js'));
        for (const ctrl of controllers) {
            const content = fs.readFileSync(path.join(controllersDir, ctrl), 'utf-8');
            const importMatches = content.matchAll(/import\s+.*?\s+from\s+['"](.+?)['"]/g);
            for (const m of importMatches) {
                const importPath = m[1];
                if (importPath.startsWith('.')) {
                    const resolved = path.resolve(path.join(controllersDir), importPath);
                    if (!exists(resolved) && !exists(resolved + '.js')) {
                        errors.push(`Import roto en ${ctrl}: ${importPath}`);
                    }
                }
            }
        }
    }

    const middlewaresDir = path.join(SRC_DIR, 'middlewares');
    const requiredMiddlewares = ['authMiddleware.js', 'errorHandler.js', 'rolesMiddleware.js'];
    for (const mw of requiredMiddlewares) {
        if (!exists(path.join(middlewaresDir, mw))) {
            errors.push(`Middleware requerido faltante: ${mw}`);
        }
    }

    const helpersDir = path.join(SRC_DIR, 'helpers');
    if (!exists(path.join(helpersDir, 'validatorHelper.js'))) {
        warnings.push('Falta helpers/validatorHelper.js');
    }

    const dbFile = path.join(SRC_DIR, 'database', 'db.js');
    if (!exists(dbFile)) {
        errors.push('Falta src/database/db.js');
    }

    return { errors, warnings };
}

module.exports = { run };

if (require.main === module) {
    const { runStandalone } = require('./_cli-helper.cjs');
    runStandalone('Estructura del proyecto', run);
}

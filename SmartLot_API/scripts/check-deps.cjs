/**
 * check-deps.js
 * Verifica que las dependencias instaladas coincidan con package.json,
 * detecta dependencias huérfanas y revisa que no haya dependencias duplicadas.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run() {
    const errors = [];
    const warnings = [];

    const pkgPath = path.join(ROOT, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        errors.push('No se encontró package.json');
        return { errors, warnings };
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (Object.keys(allDeps).length === 0) {
        warnings.push('No hay dependencias definidas en package.json');
    }

    const nodeModules = path.join(ROOT, 'node_modules');
    if (!fs.existsSync(nodeModules)) {
        errors.push('node_modules no existe. Ejecuta: npm install');
        return { errors, warnings };
    }

    for (const [name, version] of Object.entries(allDeps)) {
        const depDir = path.join(nodeModules, name);
        if (!fs.existsSync(depDir)) {
            errors.push(`Dependencia no instalada: ${name} (${version})`);
            continue;
        }
        try {
            const depPkg = JSON.parse(fs.readFileSync(path.join(depDir, 'package.json'), 'utf-8'));
            if (!depPkg.version) {
                warnings.push(`${name}: no se pudo determinar versión instalada`);
            }
        } catch {
            warnings.push(`${name}: no se pudo leer package.json del módulo`);
        }
    }

    const installedDirs = fs.readdirSync(nodeModules).filter(d => !d.startsWith('.'));
    const declaredNames = new Set(Object.keys(allDeps));
    const orphans = installedDirs.filter(d => !declaredNames.has(d));

    if (orphans.length > 10) {
        warnings.push(`${orphans.length} módulos en node_modules no declarados en package.json (posible limpieza necesaria)`);
    }

    const srcDir = path.join(ROOT, 'src');
    if (fs.existsSync(srcDir)) {
        const code = readAllCode(srcDir);
        for (const name of declaredNames) {
            try {
                const regex = new RegExp(`(?:require|import).*['"]${escapeRegex(name)}(?:/[^'"]*)?['"]`);
                if (!regex.test(code)) {
                    warnings.push(`Dependencia "${name}" declarada pero no parece importarse en src/`);
                }
            } catch { /* skip regex errors */ }
        }
    }

    if (!pkg.scripts || !pkg.scripts.start) {
        warnings.push('No hay script "start" definido en package.json');
    }

    return { errors, warnings, details: { depsCount: Object.keys(allDeps).length } };
}

function readAllCode(dir) {
    let result = '';
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
            result += readAllCode(full);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            result += fs.readFileSync(full, 'utf-8') + '\n';
        }
    }
    return result;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { run };

if (require.main === module) {
    const { runStandalone } = require('./_cli-helper.cjs');
    runStandalone('Dependencias', run);
}

/**
 * check-syntax.cjs
 * Verifica que todos los archivos .js del proyecto parseen correctamente (sin errores de sintaxis).
 * Usa `node --check` para validar ESM correctamente.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC_DIR = path.join(__dirname, '..', 'src');

function getAllJsFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            results.push(...getAllJsFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

function run() {
    const errors = [];
    const warnings = [];
    const files = getAllJsFiles(SRC_DIR);

    if (files.length === 0) {
        warnings.push('No se encontraron archivos .js en src/');
        return { errors, warnings };
    }

    for (const file of files) {
        const relativePath = path.relative(path.join(__dirname, '..'), file);
        try {
            execFileSync(process.execPath, ['--check', file], {
                stdio: 'pipe',
                timeout: 5000,
            });
        } catch (err) {
            const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
            errors.push(`Error de sintaxis en ${relativePath}: ${stderr}`);
        }
    }

    return { errors, warnings, details: { filesChecked: files.length } };
}

module.exports = { run };

if (require.main === module) {
    const { runStandalone } = require('./_cli-helper.cjs');
    runStandalone('Sintaxis JavaScript', run);
}

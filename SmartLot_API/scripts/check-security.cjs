/**
 * check-security.js
 * Escanea el código fuente en busca de problemas de seguridad comunes:
 * - Secrets hardcodeados (no via env)
 * - Console.log con datos sensibles
 * - Uso de eval/Function
 * - SQL injection patterns
 * - Archivos .env commiteados
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const SECRET_PATTERNS = [
    { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/gi, name: 'Password hardcodeado' },
    { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]/gi, name: 'API key hardcodeada' },
    { pattern: /(?:secret|token)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}['"]/gi, name: 'Secret/token hardcodeado' },
];

const DANGEROUS_PATTERNS = [
    { pattern: /\beval\s*\(/gi, name: 'Uso de eval()' },
    { pattern: /\bnew\s+Function\s*\(/gi, name: 'Uso de new Function()' },
    { pattern: /\b__dirname\b/g, name: 'Uso de __dirname (incompatible con ESM sin workaround)' },
    { pattern: /\b__filename\b/g, name: 'Uso de __filename (incompatible con ESM)' },
];

const SENSITIVE_LOG_PATTERNS = [
    { pattern: /console\.(?:log|warn|info)\s*\(.*(?:password|token|secret|key|credential)/gi, name: 'Log con datos sensibles' },
];

const SQL_INJECTION_PATTERNS = [
    { pattern: /query\s*\(\s*['"`]\s*\$\{.*\}/gi, name: 'Posible SQL injection (template literal en query)' },
    { pattern: /query\s*\(\s*['"`]\s*\+\s*/gi, name: 'Posible SQL injection (concatenación en query)' },
];

function getAllJsFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) {
            results.push(...getAllJsFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(full);
        }
    }
    return results;
}

function scanFile(filePath, patterns) {
    const findings = [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const rel = path.relative(ROOT, filePath);
    const lines = content.split('\n');

    for (const { pattern, name } of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(content)) !== null) {
            const beforeMatch = content.substring(0, match.index);
            const lineNum = beforeMatch.split('\n').length;
            const lineContent = (lines[lineNum - 1] || '').trim();

            if (isFalsePositive(name, lineContent)) continue;

            findings.push({
                file: rel,
                line: lineNum,
                rule: name,
                snippet: lineContent.substring(0, 120),
            });
        }
    }
    return findings;
}

function isFalsePositive(ruleName, line) {
    if (ruleName === 'Uso de __dirname' && line.includes('import.meta.url')) return false;
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return true;
    return false;
}

function run() {
    const errors = [];
    const warnings = [];

    const envFile = path.join(ROOT, '.env');
    if (fs.existsSync(envFile)) {
        warnings.push('.env existe en el directorio del proyecto (asegúrate de que esté en .gitignore)');
    }

    const files = getAllJsFiles(SRC_DIR);
    let totalFindings = 0;

    const allPatterns = [
        ...SECRET_PATTERNS,
        ...DANGEROUS_PATTERNS,
        ...SENSITIVE_LOG_PATTERNS,
        ...SQL_INJECTION_PATTERNS,
    ];

    for (const file of files) {
        const findings = scanFile(file, allPatterns);
        for (const f of findings) {
            totalFindings++;
            if (['Uso de eval()', 'Uso de new Function()', 'Posible SQL injection (template literal en query)', 'Posible SQL injection (concatenación en query)'].includes(f.rule)) {
                errors.push(`[SEC] ${f.file}:${f.line} - ${f.rule}: ${f.snippet}`);
            } else {
                warnings.push(`[SEC] ${f.file}:${f.line} - ${f.rule}: ${f.snippet}`);
            }
        }
    }

    if (totalFindings === 0) {
        warnings.push('No se encontraron problemas de seguridad en el código fuente');
    }

    return { errors, warnings, details: { filesScanned: files.length, findings: totalFindings } };
}

module.exports = { run };

if (require.main === module) {
    const { runStandalone } = require('./_cli-helper.cjs');
    runStandalone('Seguridad', run);
}

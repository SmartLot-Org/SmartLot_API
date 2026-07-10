/**
 * check-env.js
 * Valida que todas las variables de entorno requeridas estén definidas
 * y que no tengan valores vacíos o placeholder.
 */
const REQUIRED_VARS = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'JWT_REFRESH_SECRET',
    'JWT_REFRESH_EXPIRES_IN',
    'PORT',
    'CORS_ORIGIN',
    'FRONTEND_URL',
    'BCRYPT_ROUNDS',
    'EMAIL_USER',
    'EMAIL_PASS',
];

const RECOMMENDED_VARS = [
    'GOOGLE_MAPS_BACKEND_KEY',
    'NODE_ENV',
];

const FORBIDDEN_IN_PROD = [
    'NODE_TLS_REJECT_UNAUTHORIZED',
];

const PLACEHOLDER_PATTERNS = [
    /^your[_-]/i,
    /^changeme/i,
    /^xxx+/i,
    /^todo/i,
    /^placeholder/i,
    /^example/i,
];

function run() {
    const errors = [];
    const warnings = [];

    for (const varName of REQUIRED_VARS) {
        const value = process.env[varName];
        if (!value) {
            errors.push(`FALTA variable requerida: ${varName}`);
            continue;
        }
        if (value.trim().length === 0) {
            errors.push(`VACÍA variable requerida: ${varName}`);
            continue;
        }
        if (PLACEHOLDER_PATTERNS.some(p => p.test(value))) {
            errors.push(`PLACEHOLDER detectado en: ${varName} (valor parece no ser real)`);
        }
    }

    for (const varName of RECOMMENDED_VARS) {
        if (!process.env[varName]) {
            warnings.push(`FALTA variable recomendada: ${varName}`);
        }
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
        for (const varName of FORBIDDEN_IN_PROD) {
            if (process.env[varName]) {
                warnings.push(`Producción: ${varName} está definida (podría no ser deseable en prod)`);
            }
        }
        if (process.env.JWT_EXPIRES_IN && !process.env.JWT_EXPIRES_IN.includes('m')) {
            warnings.push(`JWT_EXPIRES_IN parece tener un formato inusual: ${process.env.JWT_EXPIRES_IN}`);
        }
    }

    return { errors, warnings };
}

module.exports = { run };

if (require.main === module) {
    const { runStandalone } = require('./_cli-helper.cjs');
    runStandalone('Variables de entorno', run);
}

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const authRateLimiter = rateLimit({
    windowMs: 3 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: true,
            message: 'Demasiadas solicitudes. Intente nuevamente en 3 minutos.',
            statusCode: 429
        });
    }
});

// Limite por cuenta para los endpoints que prueban una credencial (login, login con
// codigo, restablecer y cambiar la clave). El limitador global de arriba deja 100
// intentos cada 3 minutos por IP sobre cualquier cuenta; este corta a los 10 intentos
// fallidos sobre la misma cuenta desde la misma IP. Los aciertos no cuentan, asi que
// un usuario legitimo no se bloquea por entrar varias veces.
export const credentialRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const cuenta = String(req.body?.email ?? req.params?.id ?? '').trim().toLowerCase();
        return `${ipKeyGenerator(req.ip)}|${cuenta}`;
    },
    handler: (req, res) => {
        res.status(429).json({
            error: true,
            message: 'Demasiados intentos fallidos para esta cuenta. Intente nuevamente en 15 minutos.',
            statusCode: 429
        });
    }
});

export default authRateLimiter;

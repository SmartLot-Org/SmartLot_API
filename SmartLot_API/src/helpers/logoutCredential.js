import jwt from 'jsonwebtoken';

// Los access tokens actuales usan HS256 y no llevan type; los refresh llevan
// type=refresh. No inferir identidad de cookies de sesion, body ni jwt.decode.
export function verifyLogoutCredential(token) {
    if (typeof token !== 'string' || !token) return null;
    const secret = process.env.JWT_SECRET;
    if (typeof secret !== 'string' || !secret.trim()) throw new Error('JWT_SECRET no configurado para logout.');
    let payload;
    try {
        payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError ||
            error instanceof jwt.NotBeforeError) return null;
        throw error;
    }
    // IDs y versiones integer de PostgreSQL, sin coercion de strings/booleanos.
    const integer = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        !integer(payload.id) || payload.id === 0 || !integer(payload.token_version) ||
        !Number.isSafeInteger(payload.iat) || payload.iat < 0 ||
        !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat ||
        (payload.type !== undefined && payload.type !== 'access')) return null;
    return Object.freeze({ id: payload.id, tokenVersion: payload.token_version });
}

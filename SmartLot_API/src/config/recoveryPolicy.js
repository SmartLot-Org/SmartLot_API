// Politica compartida por emision, login y restablecimiento. Limites persistidos en SQL.
export const RECOVERY_POLICY = Object.freeze({
    maxFailures: 5,
    lifetimeSeconds: 600,
    cooldownSeconds: 60,
    issuanceWindowSeconds: 900,
    maxIssuances: 3
});
export const RECOVERY_MESSAGE = 'Si el email está registrado, te enviamos un código de verificación.';
export const INVALID_RECOVERY_MESSAGE = 'Código o email inválidos o expirados.';

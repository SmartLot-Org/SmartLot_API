import { isValidEmail } from './validatorHelper.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const email = value => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return isValidEmail(normalized) ? normalized : null;
};
const confirmedEmail = value => {
    if (typeof value !== 'string') return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = parts.slice(1).map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

// Solo para el user autenticado por Supabase getUser(), nunca para un JWT decodificado/body.
// Demuestra una asociación Google verificada, no el método de la sesión concreta.
export function getVerifiedGoogleEmail(user) {
    if (!record(user) || !uuid(user.id) ||
        (user.is_anonymous !== undefined && user.is_anonymous !== false) ||
        !confirmedEmail(user.email_confirmed_at)) return null;
    const primaryEmail = email(user.email);
    if (!primaryEmail || !Array.isArray(user.identities) || !user.identities.length) return null;

    let hasGoogle = false;
    for (const identity of user.identities) {
        if (!record(identity) || !nonEmpty(identity.provider) || !nonEmpty(identity.id) ||
            !uuid(identity.identity_id) || identity.user_id !== user.id) return null;
        if (identity.provider !== 'google') continue;
        const data = identity.identity_data;
        if (!record(data) || data.sub !== identity.id || data.email_verified !== true ||
            email(data.email) !== primaryEmail ||
            (identity.email !== undefined && email(identity.email) !== primaryEmail) ||
            (identity.provider_id !== undefined && identity.provider_id !== identity.id)) return null;
        hasGoogle = true;
    }
    return hasGoogle ? primaryEmail : null;
}

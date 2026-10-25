import { INTERNAL_SERVER_ERROR } from './httpStatus.js';

// Única forma de crear errores con status HTTP en toda la API. `extra` puede ser
// un string (se guarda como `code`) o un objeto con campos que el errorHandler
// copia al payload (`code`, `details`, `paymentId`).
// Sin statusCode explícito el error es un 500: un 400 por omisión escondería
// fallos propios detrás de un error del cliente.
export function httpError(message, statusCode = INTERNAL_SERVER_ERROR, extra) {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (typeof extra === 'string') error.code = extra;
    else if (extra) Object.assign(error, extra);
    return error;
}

export function throwError(message, statusCode, extra) {
    throw httpError(message, statusCode, extra);
}

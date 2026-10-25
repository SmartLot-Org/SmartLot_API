import { BAD_REQUEST, CONFLICT, INTERNAL_SERVER_ERROR, NOT_FOUND } from '../helpers/httpStatus.js';

// Errores de Postgres (SQLSTATE) que son culpa del pedido y no del servidor.
// El mensaje es genérico a propósito: el detalle del driver expone tablas y columnas.
const POSTGRES_ERRORS = {
    '23505': { statusCode: CONFLICT, code: 'DB_UNIQUE_VIOLATION', message: 'Ya existe un registro con esos datos.' },
    '23503': { statusCode: CONFLICT, code: 'DB_FOREIGN_KEY_VIOLATION', message: 'La operación referencia o depende de otros registros.' },
    '23502': { statusCode: BAD_REQUEST, code: 'DB_NOT_NULL_VIOLATION', message: 'Falta un dato obligatorio.' },
    '23514': { statusCode: BAD_REQUEST, code: 'DB_CHECK_VIOLATION', message: 'Los datos no cumplen las reglas del sistema.' },
    '22P02': { statusCode: BAD_REQUEST, code: 'DB_INVALID_FORMAT', message: 'Alguno de los datos tiene un formato inválido.' },
    '22001': { statusCode: BAD_REQUEST, code: 'DB_VALUE_TOO_LONG', message: 'Alguno de los datos supera el largo permitido.' },
    '22003': { statusCode: BAD_REQUEST, code: 'DB_VALUE_OUT_OF_RANGE', message: 'Alguno de los datos está fuera del rango permitido.' },
};

const errorHandler = (err, req, res, next) => {
    // Un error con statusCode ya lo decidió el service o el controller; solo los
    // que llegan sin status (excepciones del driver) se traducen acá.
    const explicitStatus = err.statusCode || err.status;
    const dbError = explicitStatus ? null : POSTGRES_ERRORS[err.code];

    const statusCode = explicitStatus || dbError?.statusCode || INTERNAL_SERVER_ERROR;
    const message = dbError?.message
        ?? (statusCode === INTERNAL_SERVER_ERROR ? 'Error interno del servidor' : err.message);

    // Un 500 no dice nada de la sesión: la invalidan authMiddleware (401) y logout.
    if (statusCode === INTERNAL_SERVER_ERROR) {
        console.error('Error no manejado:', err);
    }

    if (statusCode === NOT_FOUND) {
        console.warn(`404 ${req.method} ${req.originalUrl} -> ${err.message} ${err.paymentId ? `(paymentId=${err.paymentId})` : ''}`);
    }

    const payload = { error: true, message, statusCode };
    const code = dbError?.code ?? err.code;
    if (code) payload.code = code;
    if (err.code === 'RESERVATION_LIMIT_REACHED') payload.details = err.details;
    if (err.paymentId) payload.paymentId = err.paymentId;
    res.status(statusCode).json(payload);
};

export default errorHandler;

const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || err.status || 500;
    const isNotFoundCode = err.code === 'payment_not_found' || err.error === 'not_found';
    const message = statusCode === 500 ? 'Error interno del servidor' : err.message;

    if (statusCode === 500 && !isNotFoundCode) {
        console.error('Error no manejado:', err);
        res.clearCookie('access_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
        res.clearCookie('refresh_session_id', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/usuario/refresh' });
    }

    if (statusCode === 404) {
        console.warn(`[MP] 404 ${req.method} ${req.originalUrl} -> ${err.message} ${err.paymentId ? `(paymentId=${err.paymentId})` : ''}`);
    }

    const payload = { error: true, message, statusCode };
    if (err.code) payload.code = err.code;
    if (err.paymentId) payload.paymentId = err.paymentId;
    res.status(statusCode).json(payload);
};

export default errorHandler;

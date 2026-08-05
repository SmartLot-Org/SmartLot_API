import jwt from 'jsonwebtoken';
import pool from '../database/db.js';

const authMiddleware = async (req, res, next) => {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
            return res.status(401).json({ error: true, message: 'Formato de token invalido.', statusCode: 401 });
        }
        token = parts[1];
    }

    if (!token && req.cookies?.access_token) {
        token = req.cookies.access_token;
    }

    if (!token) {
        return res.status(401).json({ error: true, message: 'Falta el token de autenticacion.', statusCode: 401 });
    }

    try {
        req.usuario = jwt.verify(token, process.env.JWT_SECRET);
        const roleResult = await pool.query(
            'SELECT tipo_rol FROM roles WHERE id = $1 AND COALESCE("Borrado", false) = false',
            [req.usuario.id_rol]
        );
        if (!roleResult.rows[0]) {
            return res.status(401).json({ error: true, message: 'El rol del usuario no existe o esta inactivo.', statusCode: 401 });
        }
        req.usuario.tipo_rol = roleResult.rows[0].tipo_rol;
        next();
    } catch (error) {
        res.clearCookie('access_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
        res.clearCookie('refresh_session_id', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/usuario/refresh' });
        return res.status(401).json({ error: true, message: 'Token invalido o expirado.', statusCode: 401 });
    }
};

export default authMiddleware;

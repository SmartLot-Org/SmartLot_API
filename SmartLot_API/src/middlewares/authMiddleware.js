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
        const tokenUsuario = jwt.verify(token, process.env.JWT_SECRET);
        const usuarioResult = await pool.query(
            `SELECT u.id_rol, u.id_empresa, u.id_sede, r.tipo_rol
             FROM usuarios u
             INNER JOIN roles r ON r.id = u.id_rol
             WHERE u.id = $1
               AND COALESCE(u.activo, true) = true
               AND COALESCE(u."Borrado", false) = false
               AND COALESCE(r."Borrado", false) = false`,
            [tokenUsuario.id]
        );
        if (!usuarioResult.rows[0]) {
            return res.status(401).json({ error: true, message: 'El usuario no existe o esta inactivo.', statusCode: 401 });
        }
        req.usuario = {
            ...tokenUsuario,
            id_rol: usuarioResult.rows[0].id_rol,
            id_empresa: usuarioResult.rows[0].id_empresa,
            id_sede: usuarioResult.rows[0].id_sede,
            tipo_rol: usuarioResult.rows[0].tipo_rol,
        };
        next();
    } catch (error) {
        res.clearCookie('access_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
        res.clearCookie('refresh_session_id', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/usuario/refresh' });
        return res.status(401).json({ error: true, message: 'Token invalido o expirado.', statusCode: 401 });
    }
};

export default authMiddleware;

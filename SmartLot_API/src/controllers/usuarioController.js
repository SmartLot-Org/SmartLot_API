import { Router } from 'express';
import jwt from 'jsonwebtoken';
import UsuarioService from './../services/usuarioService.js';
import { isValidId, isValidEmail, isValidString, isValidPassword, isValidPhone } from '../helpers/validatorHelper.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import authRateLimiter from '../middlewares/rateLimiterMiddleware.js';

const router = Router();
const svc = new UsuarioService();

function throwError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

// GET ALL (admin o smartlot)
router.get('', authMiddleware, requireRole(1, 4), async (req, res) => {
    const data = await svc.getAllAsync(req.usuario);
    if (!data) throwError('Error interno del servidor', 500);
    res.status(200).json(data);
});

// GET BY GARAGE ID (admin, smartlot o garagista)
router.get('/garage/:id_garage', authMiddleware, requireRole(1, 3, 4, 'dueño_garage'), async (req, res) => {
    const idGarage = parseInt(req.params.id_garage);
    if (isNaN(idGarage)) throwError('El ID de garage proporcionado no es válido.', 400);

    const data = await svc.getGaragistasByGarageIdAsync(idGarage, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// LOGIN
router.post('/login', authRateLimiter, async (req, res) => {
    const { email, contraseña } = req.body;

    if (email === undefined || email === null || String(email).trim() === '') {
        throwError('El email es requerido.', 400);
    }
    if (!isValidEmail(email)) throwError('El email no tiene un formato válido.', 400);
    if (contraseña === undefined || contraseña === null) {
        throwError('La contraseña es requerida.', 400);
    }
    if (typeof contraseña !== 'string' || contraseña.trim() === '') {
        throwError('La contraseña no puede estar vacía.', 400);
    }

    const data = await svc.loginAsync({ email, contraseña });

    res.cookie('access_token', data.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000
    });

    res.cookie('refresh_session_id', data.refresh_session_id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/usuario/refresh',
        maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({
        usuario: data.usuario,
        access_token: data.access_token,
        token_type: 'Bearer',
        expires_in: '15m'
    });
});

// REFRESH TOKEN
router.post('/refresh', authRateLimiter, async (req, res) => {
    const sessionId = req.cookies?.refresh_session_id;
    if (!sessionId) {
        return res.status(401).json({ error: true, message: 'No hay sesion de refresco.', statusCode: 401 });
    }

    try {
        const data = await svc.refreshTokenAsync(sessionId);

        res.cookie('access_token', data.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000
        });

        res.cookie('refresh_session_id', data.refresh_session_id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/api/usuario/refresh',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.json({
            access_token: data.access_token,
            token_type: 'Bearer',
            expires_in: '15m'
        });
    } catch (err) {
        res.clearCookie('access_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
        res.clearCookie('refresh_session_id', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/usuario/refresh' });
        throwError(err.message, err.statusCode || 401);
    }
});

// LOGOUT
router.post('/logout', (req, res) => {
    const accessToken = req.cookies?.access_token;
    if (accessToken) {
        try {
            const decoded = jwt.decode(accessToken);
            if (decoded?.id) {
                svc.revocarRefreshTokensAsync(decoded.id).catch(() => {});
            }
        } catch {
            // Si no se puede decodificar, igual limpiamos cookies
        }
    }

    res.clearCookie('access_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    });
    res.clearCookie('refresh_session_id', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/usuario/refresh'
    });
    res.status(200).json({ message: 'Sesion cerrada exitosamente.' });
});

// IMPERSONATE (SUPERADMIN only) - returns target user data for frontend impersonation
router.post('/impersonate', authMiddleware, requireRole(4), async (req, res) => {
    const { id } = req.body;
    if (!isValidId(id)) throwError('El ID del usuario a impersonar es requerido y debe ser un número válido.', 400);

    const data = await svc.getByIdAsync(parseInt(id, 10));
    if (!data) throwError('Usuario no encontrado.', 404);

    const { contraseña, ...usuarioSinContraseña } = data;
    const accessToken = jwt.sign({
        id: usuarioSinContraseña.id,
        id_rol: usuarioSinContraseña.id_rol,
        id_empresa: usuarioSinContraseña.id_empresa,
        id_sede: usuarioSinContraseña.id_sede,
        impersonated_by: req.usuario.id,
    }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });

    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000
    });
    res.status(200).json({ usuario: usuarioSinContraseña });
});

router.post('/stop-impersonate', authMiddleware, async (req, res) => {
    const superadminId = Number(req.usuario?.impersonated_by || (Number(req.usuario?.id_rol) === 4 ? req.usuario.id : 0));
    if (!Number.isInteger(superadminId) || superadminId <= 0) throwError('No hay una impersonación activa.', 409);
    const data = await svc.getByIdAsync(superadminId);
    if (!data || Number(data.id_rol) !== 4) throwError('No se pudo restaurar la sesión SmartLot.', 403);
    const { contraseña, ...usuarioSinContraseña } = data;
    const accessToken = jwt.sign({
        id: usuarioSinContraseña.id,
        id_rol: usuarioSinContraseña.id_rol,
        id_empresa: usuarioSinContraseña.id_empresa,
        id_sede: usuarioSinContraseña.id_sede,
    }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000
    });
    res.status(200).json({ usuario: usuarioSinContraseña });
});

// GET AUTHENTICATED USER
router.get('/me', authMiddleware, (req, res) => {
    res.status(200).json({ usuario: req.usuario });
});

// GET BY ID (admin, smartlot o el propio usuario)
router.get('/auditoria', authMiddleware, requireRole(4), async (req, res) => {
    const data = await svc.getAuditAsync();
    if (!data) throwError('Error interno del servidor', 500);
    res.status(200).json(data);
});

// GET BY ID (admin, smartlot o el propio usuario)
router.get('/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throwError('El ID proporcionado no es válido.', 400);

    const rol = Number(req.usuario.id_rol);
    const esAdminOSmartlot = rol === 1 || rol === 4;
    const esPropio = Number(req.usuario.id) === id;
    if (!esAdminOSmartlot && !esPropio) throwError('No tiene permisos para ver este usuario.', 403);

    const data = await svc.getByIdAsync(id, req.usuario);
    if (!data) throwError('No encontrado.', 404);
    res.status(200).json(data);
});

// CREATE (POST) - admin o smartlot
router.post('', authMiddleware, requireRole(1, 4), async (req, res) => {
    const { id_rol, nombre, apellido, id_sede, email, telefono, contraseña, id_empresa, id_garage, activo } = req.body;
    if (!isValidString(nombre)) throwError('El nombre es requerido.', 400);
    if (!isValidString(apellido)) throwError('El apellido es requerido.', 400);
    if (!isValidEmail(email)) throwError('El email no tiene un formato válido.', 400);
    if (!isValidPassword(contraseña)) throwError('La contraseña debe tener al menos 8 caracteres, mayúsculas, minúsculas y números.', 400);
    if (!isValidId(id_rol)) throwError('El id_rol es requerido y debe ser un número válido.', 400);
    const rolSolicitado = await svc.rolService.getByIdAsync(Number(id_rol));
    if (!rolSolicitado) throwError('El rol indicado no existe.', 400);
    const tipoRol = rolSolicitado.tipo_rol?.toLowerCase();
    const esGaragista = tipoRol === 'garagista';
    const esDuenoGarage = tipoRol === 'dueño_garage';
    const esSuperadmin = tipoRol === 'superadmin' || Number(id_rol) === 4;
    const esAdmin = tipoRol === 'admin' || Number(id_rol) === 1;

    if (esGaragista) {
        if (id_sede !== undefined && id_sede !== null && !isValidId(id_sede)) {
            throwError('El id_sede debe ser nulo o un número válido para el garagista.', 400);
        }
        if (!isValidId(id_garage)) {
            throwError('El id_garage es requerido para el rol garagista y debe ser un número válido.', 400);
        }
    } else if (esDuenoGarage) {
        // El dueño se crea sin relaciones iniciales. Puede controlar varios
        // garages mediante las filas existentes de usuario_garage.
        req.body.id_sede = null;
        req.body.id_empresa = null;
        req.body.id_garage = null;
    } else if (esAdmin) {
        if (id_sede !== null && id_sede !== undefined && !isValidId(id_sede)) {
            throwError('El id_sede debe ser un número válido.', 400);
        }
    } else if (!esSuperadmin) {
        if (!isValidId(id_sede)) throwError('El id_sede es requerido y debe ser un número válido.', 400);
    }

    if (!esSuperadmin && !esDuenoGarage && !isValidId(id_empresa)) {
        throwError('El id_empresa es requerido y debe ser un número válido.', 400);
    }
    if (telefono && !isValidPhone(telefono)) throwError('El teléfono debe contener solo dígitos (mínimo 7).', 400);
    if (id_garage !== undefined && id_garage !== null && id_garage !== '' && !isValidId(id_garage)) throwError('El id_garage debe ser un número válido.', 400);

    if (id_sede === '' || id_sede === undefined || id_sede === null) req.body.id_sede = null;
    if (id_empresa === '' || id_empresa === undefined || id_empresa === null) req.body.id_empresa = null;
    if (id_garage === '' || id_garage === undefined || id_garage === null) req.body.id_garage = null;

    const data = await svc.createAsync(req.body);
    if (!data) throwError('Error interno al crear el usuario.', 500);
    res.status(201).json(data);
});

// UPDATE (PUT) - admin, smartlot o el propio usuario
router.put('/:id', authMiddleware, requireRole(1, 2, 3, 4, 'dueño_garage'), async (req, res) => {
    const id = req.params.id;

    if (!isValidId(id)) throwError('El ID proporcionado no es válido.', 400);

    const { id_rol, id_sede, id_empresa, email, telefono, contraseña } = req.body;
    if (id_sede && !isValidId(String(id_sede))) throwError('El id_sede debe ser un número válido.', 400);
    if (id_empresa && !isValidId(String(id_empresa))) throwError('La empresa debe ser un número válido.', 400);
    if (telefono && !isValidPhone(telefono)) throwError('El teléfono debe contener solo dígitos (mínimo 7).', 400);
    if (email && !isValidEmail(email)) throwError('El email no tiene un formato válido.', 400);
    if (contraseña && !isValidPassword(contraseña)) throwError('La contraseña debe tener al menos 8 caracteres, mayúsculas, minúsculas y números.', 400);

    const data = await svc.updateAsync(parseInt(id, 10), req.body, req.usuario);
    if (!data) throwError('No encontrado: El usuario con ese ID no existe.', 404);
    res.status(200).json(data);
});

// UPDATE CONTRASEÑA (PATCH) - admin, smartlot o el propio usuario
router.patch(['/:id/contraseña', '/:id/contrasenia', '/:id/contrase%C3%B1a'], authMiddleware, requireRole(1, 4), async (req, res) => {
    const id = req.params.id;

    if (!isValidId(id)) throwError('El ID proporcionado no es válido.', 400);

    const { contraseña } = req.body;
    if (!contraseña || !isValidPassword(contraseña)) {
        throwError('La contraseña debe tener al menos 8 caracteres, mayúsculas, minúsculas y números.', 400);
    }

    const data = await svc.updateContraseñaAsync(parseInt(id, 10), contraseña, req.usuario);
    if (!data) throwError('No encontrado: El usuario con ese ID no existe.', 404);
    res.status(200).json({ message: 'Contraseña actualizada exitosamente.' });
});

// UPDATE ESTADO (PATCH) - admin o smartlot
router.patch('/:id/estado', authMiddleware, requireRole(1, 4), async (req, res) => {
    const id = req.params.id;
    const { activo } = req.body;

    if (!isValidId(id)) throwError('El ID proporcionado no es válido.', 400);

    if (activo === undefined || typeof activo !== 'boolean') {
        throwError('El campo "activo" es requerido y debe ser un valor booleano (true/false).', 400);
    }

    const data = await svc.updateEstadoAsync(parseInt(id, 10), activo, req.usuario);
    if (!data) throwError('No encontrado: El usuario con ese ID no existe.', 404);
    res.status(200).json(data);
});

// DELETE - admin o smartlot
router.delete('/:id', authMiddleware, requireRole(1, 4), async (req, res) => {
    const id = req.params.id;

    if (!isValidId(id)) throwError('El ID proporcionado no es válido.', 400);

    const ok = await svc.deleteAsync(parseInt(id, 10), req.usuario);
    if (!ok) throwError('No encontrado: El usuario con ese ID no existe.', 404);
    res.status(200).json({ message: 'Usuario eliminado exitosamente.' });
});

export default router;

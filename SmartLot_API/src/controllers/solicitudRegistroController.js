import { Router } from 'express';
import SolicitudRegistroService from '../services/solicitudRegistroService.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rolesMiddleware.js';
import authRateLimiter from '../middlewares/rateLimiterMiddleware.js';
import { isValidId } from '../helpers/validatorHelper.js';

const router = Router();
const svc = new SolicitudRegistroService();
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const parseId = (value) => {
    if (!isValidId(value)) fail('El ID debe ser un entero positivo.');
    return Number(value);
};

// SOLICITUD DE REGISTRO DE EMPRESA (público, sin autenticación) - queda pendiente
// de validación por un superadmin. El estado y los enlaces con empresa/usuario
// SIEMPRE los decide el servidor, nunca el cliente.
router.post('', authRateLimiter, async (req, res) => {
    await svc.createAsync(req.body || {});
    res.status(202).json({
        message: 'Recibimos tu solicitud. Si corresponde procesarla, te contactaremos por correo. Si ya tenés una cuenta, podés iniciar sesión o recuperar tu contraseña.',
    });
}, (err, req, res, next) => {
    if ((err?.statusCode || err?.status || 500) === 500) {
        return next(Object.assign(new Error('Error interno del servidor'), {
            statusCode: 500, preserveAuthCookies: true,
        }));
    }
    next(err);
});

// LISTAR SOLICITUDES (superadmin)
router.get('', authMiddleware, requireRole(4), async (req, res) => {
    res.status(200).json(await svc.getAllAsync(req.query.estado ?? null));
});

// OBTENER UNA SOLICITUD POR ID (superadmin) - sin contraseña_hash
router.get('/:id', authMiddleware, requireRole(4), async (req, res) => {
    res.status(200).json(await svc.getByIdAsync(parseId(req.params.id)));
});

// APROBAR (superadmin) - crea la empresa y el usuario administrador en una transacción
router.patch('/:id/aprobar', authMiddleware, requireRole(4), async (req, res) => {
    res.status(200).json(await svc.approveAsync(parseId(req.params.id), req.usuario));
});

// RECHAZAR (superadmin)
router.patch('/:id/rechazar', authMiddleware, requireRole(4), async (req, res) => {
    res.status(200).json(await svc.rejectAsync(parseId(req.params.id), req.usuario));
});

export default router;

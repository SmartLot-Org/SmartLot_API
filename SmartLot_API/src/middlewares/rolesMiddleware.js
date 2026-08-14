// rolesMiddleware.js
// Middleware de autorizacion por rol.
// Se aplica DESPUES de authMiddleware, ya que necesita `req.usuario` con `id_rol`.

/**
 * Permite el paso solo si el usuario autenticado tiene uno de los roles indicados.
 * Uso: router.post('/x', authMiddleware, requireRole(1, 3), handler)
 *
 * Convencion historica de IDs (verificar contra la tabla `roles`):
 *   1 = admin
 *   2 = cliente
 *   3 = garagista
 */
import { hasRole } from '../helpers/roles.js';

const requireRole = (...rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ error: true, message: 'No autenticado.', statusCode: 401 });
        }

        if (!hasRole(req.usuario, ...rolesPermitidos)) {
            return res.status(403).json({
                error: true, message: 'No tiene permisos para realizar esta accion.', statusCode: 403
            });
        }

        next();
    };
};

/**
 * Atajo para admin. Uso: router.delete('/x', authMiddleware, requireAdmin, handler)
 */
const requireAdmin = requireRole(1);

/**
 * Permite el paso si el usuario tiene uno de los roles indicados O es el propio usuario solicitando el cambio.
 * Uso: router.patch('/:id/contraseña', authMiddleware, requireRoleOrSelf(1, 4), handler)
 *
 * Convencion: el usuario autenticado puede cambiar su propia contraseña (coincide id),
 * o bien tener rol 1 (admin) o 4 (superadmin/smartlot) para cambiar cualquier usuario.
 */
const requireRoleOrSelf = (...rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ error: true, message: 'No autenticado.', statusCode: 401 });
        }

        if (hasRole(req.usuario, ...rolesPermitidos)) {
            return next();
        }

        if (Number(req.usuario.id) === Number(req.params.id)) {
            return next();
        }

        return res.status(403).json({
            error: true, message: 'No tiene permisos para realizar esta accion.', statusCode: 403
        });
    };
};

export { requireRole, requireAdmin, requireRoleOrSelf };
export default requireRole;

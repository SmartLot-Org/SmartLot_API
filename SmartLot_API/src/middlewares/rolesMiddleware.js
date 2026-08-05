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

export { requireRole, requireAdmin };
export default requireRole;

// usuarioService.js
import pool from '../database/db.js';
import RecoveryService from './recoveryService.js';
import UsuarioRepository from '../repositories/usuarioRepository.js';
import SedeService from './sedeService.js';
import EmpresaService from './empresaService.js';
import RolService from './rolService.js';
import GarageService from './garageService.js';
import UsuarioGarageService from './usuarioGarageService.js';
import { enviarCorreoDesdePlantilla } from './emailService.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { validateReservationLimit } from '../helpers/reservationPolicy.js';
import { authorizeWrite, authorizeUserEdit, authorizeUserEditDestination, authorizeUserLifecycle } from '../helpers/writeAuthorization.js';
import { verifyLogoutCredential } from '../helpers/logoutCredential.js';
import { httpError } from '../helpers/httpError.js';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
// Una sola preparación por proceso, con el costo configurado. Nunca autoriza una sesión.
const LOGIN_DUMMY_HASH = bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usableLoginHash = value => typeof value === 'string' &&
    /^\$2[ab]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.test(value);

// Regla de negocio: un garagista no depende de empresa ni sede. Su relacion con
// los garages vive exclusivamente en `usuario_garage`. El servidor fuerza estos
// campos a NULL sin importar lo que envie el cliente.
const esRolGaragista = (rol) =>
    Number(rol?.id) === 3 || String(rol?.tipo_rol ?? '').trim().toLowerCase() === 'garagista';

export default class UsuarioService {
    constructor() {
        console.log('Estoy en: UsuarioService.constructor()');
        this.repo = new UsuarioRepository();
        this.sedeService = new SedeService();
        this.empresaService = new EmpresaService();
        this.rolService = new RolService();
        this.garageService = new GarageService();
        this.usuarioGarageService = new UsuarioGarageService();
    }

    // Lazy-loaded to avoid circular dependency with ReservaService
    _getReservaService = async () => {
        if (!this._reservaServiceInstance) {
            const { default: ReservaService } = await import('./reservaService.js');
            this._reservaServiceInstance = new ReservaService();
        }
        return this._reservaServiceInstance;
    }

    getAllAsync = async (requestingUser = null) => await this.repo.getAllAsync(requestingUser);

    getByIdAsync = async (id, requestingUser = null) => await this.repo.getByIdAsync(id, requestingUser);

    updateReservationLimitAsync = async (id, limit, actor) => {
        validateReservationLimit(limit);
        return this.repo.updateReservationLimitAsync(id, limit, actor);
    };

    getAuditAsync = async () => await this.repo.getAuditAsync();

    loginAsync = async (credentials) => {
        const usuario = await this.repo.getByEmailAsync(credentials.email);
        const hasRealHash = usableLoginHash(usuario?.contraseña);
        const coincide = await bcrypt.compare(
            credentials.contraseña,
            hasRealHash ? usuario.contraseña : await LOGIN_DUMMY_HASH
        );

        if (!usuario || !hasRealHash || usuario.activo === false || usuario.Borrado === true || !coincide) {
            const error = new Error('Credenciales incorrectas.');
            error.statusCode = 401;
            throw error;
        }

        const { contraseña, ...usuarioSinContraseña } = usuario;

        const payload = {
            id: usuario.id,
            email: usuario.email,
            id_rol: usuario.id_rol,
            id_empresa: usuario.id_empresa,
            id_sede: usuario.id_sede,
            token_version: usuario.token_version,
            ...(usuario.id_garage != null ? { id_garage: usuario.id_garage } : {})
        };

        const accessToken = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || '15m'
            }
        );

        const refreshToken = jwt.sign(
            { id: usuario.id, token_version: usuario.token_version, type: 'refresh' },
            process.env.JWT_REFRESH_SECRET,
            {
                expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
            }
        );

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const sessionId = await this.repo.createSessionAsync(
            usuario.id,
            usuario.token_version,
            refreshToken,
            expiresAt
        );
        if (!sessionId) {
            const error = new Error('No se pudo crear la sesión.');
            error.statusCode = 500;
            throw error;
        }

        return {
            usuario: usuarioSinContraseña,
            access_token: accessToken,
            refresh_session_id: sessionId,
            token_type: 'Bearer',
            expires_in: process.env.JWT_EXPIRES_IN || '15m'
        };
    }

    refreshTokenAsync = async (session_id) => {
        // El id viaja en una cookie que el cliente puede alterar: uno mal formado es
        // una sesión inexistente (401), no un error de la base.
        const session = UUID_RE.test(String(session_id)) ? await this.repo.getSessionAsync(session_id) : null;
        if (!session) {
            const error = new Error('Sesion invalida o expirada.');
            error.statusCode = 401;
            throw error;
        }

        let decoded;
        try {
            decoded = jwt.verify(session.refresh_token, process.env.JWT_REFRESH_SECRET);
        } catch {
            await this.repo.deleteSessionAsync(session_id);
            const error = new Error('Refresh token invalido o expirado.');
            error.statusCode = 401;
            throw error;
        }

        if (decoded.type !== 'refresh') {
            await this.repo.deleteSessionAsync(session_id);
            const error = new Error('Tipo de token incorrecto.');
            error.statusCode = 401;
            throw error;
        }

        const usuario = await this.repo.getByIdAsync(decoded.id);
        if (!usuario || usuario.activo === false) {
            await this.repo.deleteSessionAsync(session_id);
            const error = new Error('Usuario no encontrado o desactivado.');
            error.statusCode = 401;
            throw error;
        }

        if (Number(usuario.token_version) !== Number(decoded.token_version)) {
            await this.repo.deleteSessionAsync(session_id);
            const error = new Error('Refresh token revocado.');
            error.statusCode = 401;
            throw error;
        }

        const { contraseña, ...usuarioData } = usuario;

        const newAccessToken = jwt.sign(
            {
                id: usuario.id,
                email: usuario.email,
                id_rol: usuario.id_rol,
                id_empresa: usuario.id_empresa,
                id_sede: usuario.id_sede,
                token_version: usuario.token_version,
                ...(usuario.id_garage != null ? { id_garage: usuario.id_garage } : {})
            },
            process.env.JWT_SECRET,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || '15m'
            }
        );

        const newRefreshToken = jwt.sign(
            { id: usuario.id, token_version: usuario.token_version, type: 'refresh' },
            process.env.JWT_REFRESH_SECRET,
            {
                expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
            }
        );

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const newSessionId = await this.repo.createSessionAsync(
            usuario.id,
            usuario.token_version,
            newRefreshToken,
            expiresAt
        );

        await this.repo.deleteSessionAsync(session_id);

        return {
            access_token: newAccessToken,
            refresh_session_id: newSessionId,
            token_type: 'Bearer',
            expires_in: process.env.JWT_EXPIRES_IN || '15m'
        };
    }

    revocarRefreshTokensAsync = async (id) => {
        const version = await this.repo.incrementTokenVersionAsync(id);
        if (version === null) throw httpError('Usuario no encontrado.', 404);
        await this.repo.deleteUserSessionsAsync(id);
        return version;
    }

    logoutAsync = async (accessToken) => {
        const credential = verifyLogoutCredential(accessToken);
        if (!credential) return false;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const revoked = await this.repo.revokeLogoutSessionsAsync(credential.id, credential.tokenVersion, client);
            await client.query('COMMIT');
            return revoked;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }

    getGaragistasByGarageIdAsync = async (id_garage, requestingUser = null) => {
        // Validar que el garage exista (con filtro de tenant).
        const garage = await this.garageService.getByIdAsync(id_garage, requestingUser);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }
        const usuarios = await this.usuarioGarageService.getUsuariosByGarageIdAsync(id_garage, requestingUser);
        return usuarios.map(({ contraseña, ...usuario }) => usuario);
    }

    createAsync = async (entity) => {
        // Obtener el rol primero: si es garagista, se anulan sede y empresa antes
        // de validar relaciones, para que el cliente no pueda imponerlas.
        const rol = await this.rolService.getByIdAsync(entity.id_rol);
        const esGaragista = esRolGaragista(rol);

        if (esGaragista) {
            entity.id_sede = null;
            entity.id_empresa = null;
        }

        await this._validarRelacionesAsync(entity);

        // Validaciones si es "garagista"
        if (esGaragista) {
            if (!entity.id_garage) {
                const error = new Error('El campo id_garage es requerido para el rol garagista.');
                error.statusCode = 400;
                throw error;
            }
            const garage = await this.garageService.getByIdAsync(entity.id_garage);
            if (!garage) {
                const error = new Error(`El garage no existe.`);
                error.statusCode = 400;
                throw error;
            }
        }

        // Validar email único
        if (entity.email) {
            const existing = await this.repo.getByEmailAsync(entity.email);
            if (existing) {
                const error = new Error(`Ya existe un usuario con el email ${entity.email}.`);
                error.statusCode = 400;
                throw error;
            }
        }

        // Hashear contraseña 
        if (entity.contraseña) {
            entity.contraseña = await bcrypt.hash(entity.contraseña, BCRYPT_ROUNDS);
        }

        if (esGaragista) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Crear usuario con el cliente de la transacción
                const nuevoUsuario = await this.repo.createWithClientAsync(entity, client);
                if (!nuevoUsuario) {
                    throw new Error('Error al insertar el usuario en la base de datos.');
                }

                // Crear relación usuario_garage con el cliente de la transacción
                await this.usuarioGarageService.createWithClientAsync(nuevoUsuario.id, entity.id_garage, client);

                await client.query('COMMIT');

                const nombreCompleto = `${nuevoUsuario.nombre ?? ''} ${nuevoUsuario.apellido ?? ''}`.trim() || 'Usuario';
                try {
await enviarCorreoDesdePlantilla(nuevoUsuario.email, 'bienvenida', { nombre: nombreCompleto, email: nuevoUsuario.email });
                } catch (err) {
                    console.error('Error al enviar correo de bienvenida:', err);
                }

                return nuevoUsuario;
            } catch (error) {
                try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('ROLLBACK falló:', rollbackError); }
                throw error;
            } finally {
                client.release();
            }
        } else {
            const nuevoUsuario = await this.repo.createAsync(entity);

            const nombreCompleto = `${nuevoUsuario.nombre ?? ''} ${nuevoUsuario.apellido ?? ''}`.trim() || 'Usuario';
            try {
                await enviarCorreoDesdePlantilla(nuevoUsuario.email, 'bienvenida', { nombre: nombreCompleto, email: nuevoUsuario.email });
            } catch (err) {
                console.error('Error al enviar correo de bienvenida:', err);
            }

            return nuevoUsuario;
        }
    }

    updateAsync = async (id, entity, requestingUser) => {
        return this._withAuthorizedUserEdit(id, requestingUser, async (current, scope, client) => {
            entity = { ...entity };
            await this._aplicarReglasDeActualizacion(entity, requestingUser, current, client);

            // El estado tiene autorizacion y efectos transaccionales propios. Un
            // formulario completo puede reenviar el valor actual, pero no cambiarlo.
            if (entity.activo !== undefined && entity.activo !== current.activo) {
                throw httpError('Para cambiar el estado utilice PATCH /api/usuario/:id/estado.', 400);
            }

            // Un garagista nunca depende de empresa ni sede: si el usuario ya lo es,
            // o si este update le asigna ese rol, los campos se fuerzan a NULL.
            const rolEfectivoId = entity.id_rol !== undefined ? entity.id_rol : current.id_rol;
            const tipoRolEfectivo = entity.id_rol !== undefined
                ? (await this.repo.getEditRoleAsync(entity.id_rol, client))?.tipo_rol
                : current.tipo_rol;
            if (esRolGaragista({ id: rolEfectivoId, tipo_rol: tipoRolEfectivo })) {
                entity.id_sede = null;
                entity.id_empresa = null;
            }

            // Merge: preservar valores actuales para campos no enviados
            const merged = { ...current, ...entity };

            // Preservar contraseña existente si no se envía una nueva
            if (entity.contraseña) {
                merged.contraseña = await bcrypt.hash(entity.contraseña, BCRYPT_ROUNDS);
            } else {
                merged.contraseña = current.contraseña;
            }

            const destination = await this.repo.validateEditDestinationAsync(merged, client);
            authorizeUserEditDestination(scope, merged, destination);

            // Validar email único (excluyendo al usuario actual)
            if (merged.email) {
                const existing = await this.repo.getEditEmailAsync(merged.email, client);
                if (existing && existing.id !== id) {
                    const error = new Error(`Ya existe un usuario con el email ${merged.email}.`);
                    error.statusCode = 400;
                    throw error;
                }
            }

            return await this.repo.updateAsync(id, merged, scope, client);
        });
    }

    updateEstadoAsync = async (id, activo, requestingUser = null) => {
        if (typeof activo !== 'boolean') throw httpError('El estado debe ser booleano.', 400);
        return this._changeLifecycleAsync(id, requestingUser, false, activo);
    }

    updateContraseñaAsync = async (id, contraseña, requestingUser) => {
        let current;
        const result = await this._withAuthorizedUserEdit(id, requestingUser, async (target, scope, client) => {
            current = target;
            await this._aplicarReglasDeActualizacion({}, requestingUser, target, client);
            const hash = await bcrypt.hash(contraseña, BCRYPT_ROUNDS);
            const updated = await this.repo.updateContraseñaAsync(id, hash, scope, client);
            if (!updated) throw httpError('El usuario cambio durante la operacion.', 409);
            await this.repo.revokeLifecycleSessionsAsync(id, client);
            return updated;
        });
        const nombreCompleto = `${current.nombre ?? ''} ${current.apellido ?? ''}`.trim() || 'Usuario';
        try {
            await enviarCorreoDesdePlantilla(current.email, 'cambio_contraseña', { nombre: nombreCompleto });
        } catch (err) {
            console.error('Error al enviar correo de cambio de contraseña:', err);
        }

        return result;
    }

    solicitarRecuperoAsync = (email) => new RecoveryService().request(email);
    loginConCodigoAsync = (email, codigo) => new RecoveryService().login(email, codigo);
    restablecerClaveAsync = (email, codigo, password) => new RecoveryService().reset(email, codigo, password);

    deleteAsync = async (id, requestingUser = null) => {
        return this._changeLifecycleAsync(id, requestingUser, true);
    }

    _changeLifecycleAsync = async (id, actor, deleting, activo) => {
        const scope = authorizeWrite(actor);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // El alta de reservas tambien bloquea este usuario antes de insertar.
            const target = await this.repo.getForLifecycleAsync(id, scope, client);
            if (!target) throw httpError('Usuario no encontrado.', 404);
            authorizeUserLifecycle(scope, target);
            if (deleting || !activo) {
                await this.repo.validateLifecycleReservationsAsync(id, deleting, client);
            }
            const result = deleting ? await this.repo.deleteAsync(id, scope, client) :
                await this.repo.updateEstadoAsync(id, activo, scope, client);
            if (!result) throw httpError('El usuario cambio durante la operacion.', 409);
            await this.repo.revokeLifecycleSessionsAsync(id, client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }

    /**
     * Valida que las entidades relacionadas (rol, sede, empresa) existan en la BD.
     * Lanza un error descriptivo si alguna no existe.
     */
    _validarRelacionesAsync = async (entity) => {
        const errores = [];

        // Validar que el rol exista
        if (entity.id_rol) {
            const rol = await this.rolService.getByIdAsync(entity.id_rol);
            if (!rol) {
                errores.push(`El rol con ID ${entity.id_rol} no existe.`);
            }
        }

        // Validar que la empresa exista
        if (entity.id_empresa) {
            const empresa = await this.empresaService.getByIdAsync(entity.id_empresa);
            if (!empresa) {
                errores.push(`La empresa con ID ${entity.id_empresa} no existe.`);
            }
        }

        // Validar que la sede exista
        if (entity.id_sede) {
            const sede = await this.sedeService.getByIdAsync(entity.id_sede);
            if (!sede) {
                errores.push(`La sede con ID ${entity.id_sede} no existe.`);
            }
        }

        if (errores.length > 0) {
            const error = new Error(errores.join(' '));
            error.statusCode = 400;
            throw error;
        }
    }

    _validarSinReservasActivasAsync = async (id_usuario, accion) => {
        const reservaService = await this._getReservaService();
        const reservasActivas = await reservaService.getActivasByUsuarioAsync(id_usuario);
        if (reservasActivas && reservasActivas.length > 0) {
            const error = new Error(`No se puede ${accion} el usuario con ID ${id_usuario} porque tiene reservas activas.`);
            error.statusCode = 400;
            throw error;
        }
    }

    _validarSinReservasAsync = async (id_usuario, accion) => {
        const reservaService = await this._getReservaService();
        const reservas = await reservaService.getByUsuarioAsync(id_usuario);
        if (reservas && reservas.length > 0) {
            const error = new Error(`No se puede ${accion} el usuario con ID ${id_usuario} porque tiene reservas asociadas.`);
            error.statusCode = 400;
            throw error;
        }
    }

    _withAuthorizedUserEdit = async (id, actor, operation) => {
        const scope = authorizeUserEdit(actor, id);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const current = await this.repo.getForEditAsync(id, scope, client);
            if (!current) throw httpError('Usuario no encontrado.', 404);
            if (Number(actor.id_rol) === 1) authorizeUserLifecycle(scope, current);
            const result = await operation(current, scope, client);
            if (!result) throw httpError('El usuario cambio durante la operacion.', 409);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }

    _aplicarReglasDeActualizacion = async (entity, requestingUser, current, client) => {
        const rol = Number(requestingUser.id_rol);
        const esAdmin = rol === 1;
        const esSmartlot = rol === 4;
        const esAdminOrSmartlot = esAdmin || esSmartlot;
        const esPropio = Number(requestingUser.id) === Number(current.id);

        if (!esAdminOrSmartlot && !esPropio) {
            const error = new Error('No tiene permisos para modificar este usuario.');
            error.statusCode = 403;
            throw error;
        }

        if (esPropio) {
            // Ningun usuario puede autoasignarse privilegios ni contexto de tenant.
            delete entity.id_rol;
            delete entity.id_sede;
            delete entity.id_empresa;
            delete entity.activo;
        }

        if (!esPropio && esAdmin && entity.id_rol !== undefined) {
            const targetRol = await this.repo.getEditRoleAsync(entity.id_rol, client);
            const tipo = targetRol?.tipo_rol?.toLowerCase();
            if (!['cliente', 'empleado', 'garagista'].includes(tipo)) {
                const error = new Error('No puede asignar el rol indicado.');
                error.statusCode = 400;
                throw error;
            }
        }

        if (!esPropio && esAdmin && !esSmartlot) {
            if (entity.id_empresa !== undefined && Number(entity.id_empresa) !== Number(requestingUser.id_empresa)) {
                throw httpError('La empresa de destino no esta autorizada.', 403);
            }
            if (requestingUser.id_sede != null && entity.id_sede !== undefined &&
                Number(entity.id_sede) !== Number(requestingUser.id_sede)) {
                throw httpError('La sede de destino no esta autorizada.', 403);
            }
            delete entity.id_empresa;
        }

        if (!esAdminOrSmartlot) {
            delete entity.id_rol;
            delete entity.activo;
            delete entity.id_empresa;
        }
    }
}

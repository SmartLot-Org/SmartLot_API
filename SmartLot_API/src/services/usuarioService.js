// usuarioService.js
import pool from '../database/db.js';
import UsuarioRepository from '../repositories/usuarioRepository.js';
import SedeService from './sedeService.js';
import EmpresaService from './empresaService.js';
import RolService from './rolService.js';
import GarageService from './garageService.js';
import UsuarioGarageService from './usuarioGarageService.js';
import { enviarCorreo, plantillaBienvenida, plantillaCambioContraseña } from './emailService.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

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

    getAuditAsync = async () => await this.repo.getAuditAsync();

    loginAsync = async (credentials) => {
        const usuario = await this.repo.getByEmailAsync(credentials.email);

        if (!usuario) {
            const error = new Error('Credenciales incorrectas.');
            error.statusCode = 401;
            throw error;
        }

        if (usuario.activo === false) {
            const error = new Error('Cuenta desactivada.');
            error.statusCode = 403;
            throw error;
        }

        const coincide = await bcrypt.compare(
            credentials.contraseña,
            usuario.contraseña
        );

        if (!coincide) {
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

        return {
            usuario: usuarioSinContraseña,
            access_token: accessToken,
            refresh_session_id: sessionId,
            token_type: 'Bearer',
            expires_in: process.env.JWT_EXPIRES_IN || '15m'
        };
    }

    refreshTokenAsync = async (session_id) => {
        const session = await this.repo.getSessionAsync(session_id);
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
        if (version === null) {
            const error = new Error('Error al revocar tokens del usuario.');
            error.statusCode = 500;
            throw error;
        }
        await this.repo.deleteUserSessionsAsync(id);
        return version;
    }

    getGaragistasByGarageIdAsync = async (id_garage, requestingUser = null) => {
        // Validar que el garage exista (con filtro de tenant).
        const garage = await this.garageService.getByIdAsync(id_garage, requestingUser);
        if (!garage) {
            const error = new Error(`El garage no existe.`);
            error.statusCode = 404;
            throw error;
        }
        return await this.usuarioGarageService.getUsuariosByGarageIdAsync(id_garage, requestingUser);
    }

    createAsync = async (entity) => {
        await this._validarRelacionesAsync(entity);

        // Obtener el rol para verificar si es "garagista"
        const rol = await this.rolService.getByIdAsync(entity.id_rol);
        const esGaragista = rol && rol.tipo_rol && rol.tipo_rol.toLowerCase() === 'garagista';

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
                enviarCorreo(nuevoUsuario.email, 'Bienvenido a SmartLot', plantillaBienvenida(nombreCompleto, nuevoUsuario.email))
                    .catch(err => console.error('Error al enviar correo de bienvenida:', err));

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
            enviarCorreo(nuevoUsuario.email, 'Bienvenido a SmartLot', plantillaBienvenida(nombreCompleto, nuevoUsuario.email))
                .catch(err => console.error('Error al enviar correo de bienvenida:', err));

            return nuevoUsuario;
        }
    }

    updateAsync = async (id, entity, requestingUser) => {
        const current = await this.repo.getByIdAsync(id);
        if (!current) {
            const error = new Error(`El usuario con ID ${id} no existe.`);
            error.statusCode = 404;
            throw error;
        }

        this._aplicarReglasDeActualizacion(entity, requestingUser, id);

        // Merge: preservar valores actuales para campos no enviados
        const merged = { ...current, ...entity };

        // Preservar contraseña existente si no se envía una nueva
        if (entity.contraseña) {
            merged.contraseña = await bcrypt.hash(entity.contraseña, BCRYPT_ROUNDS);
        } else {
            merged.contraseña = current.contraseña;
        }

        await this._validarRelacionesAsync(merged);

        // Validar email único (excluyendo al usuario actual)
        if (merged.email) {
            const existing = await this.repo.getByEmailAsync(merged.email);
            if (existing && existing.id !== id) {
                const error = new Error(`Ya existe un usuario con el email ${merged.email}.`);
                error.statusCode = 400;
                throw error;
            }
        }

        return await this.repo.updateAsync(id, merged, requestingUser?.id ?? null);
    }

    updateEstadoAsync = async (id, activo, requestingUser = null) => {
        // 1. Validar primero que el usuario exista
        const usuario = await this.repo.getByIdAsync(id);
        if (!usuario) {
            const error = new Error(`El usuario con ID ${id} no existe.`);
            error.statusCode = 404;
            throw error;
        }

        if (activo === false) {
            await this._validarSinReservasActivasAsync(id, 'desactivar');
        }

        // 2. Revocar tokens si se desactiva o reactiva
        await this.repo.incrementTokenVersionAsync(id);

        // 3. Llamar al repositorio para hacer el update parcial
        return await this.repo.updateEstadoAsync(id, activo, requestingUser?.id ?? null);
    }

    updateContraseñaAsync = async (id, contraseña, requestingUser) => {
        const current = await this.repo.getByIdAsync(id);
        if (!current) {
            const error = new Error(`El usuario con ID ${id} no existe.`);
            error.statusCode = 404;
            throw error;
        }

        this._aplicarReglasDeActualizacion({}, requestingUser, id);

        const hash = await bcrypt.hash(contraseña, BCRYPT_ROUNDS);

        await this.repo.incrementTokenVersionAsync(id);

        const result = await this.repo.updateContraseñaAsync(id, hash, requestingUser?.id ?? null);

        const nombreCompleto = `${current.nombre ?? ''} ${current.apellido ?? ''}`.trim() || 'Usuario';
        enviarCorreo(current.email, 'Contraseña Actualizada - SmartLot', plantillaCambioContraseña(nombreCompleto))
            .catch(err => console.error('Error al enviar correo de cambio de contraseña:', err));

        return result;
    }

    deleteAsync = async (id, requestingUser = null) => {
        const usuario = await this.repo.getByIdAsync(id);
        if (!usuario) {
            const error = new Error(`El usuario con ID ${id} no existe.`);
            error.statusCode = 404;
            throw error;
        }

        await this._validarSinReservasAsync(id, 'eliminar');

        return await this.repo.deleteAsync(id, requestingUser?.id ?? null);
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

    _aplicarReglasDeActualizacion = (entity, requestingUser, targetId) => {
        const rol = Number(requestingUser.id_rol);
        const esAdmin = rol === 1;
        const esSmartlot = rol === 4;
        const esAdminOrSmartlot = esAdmin || esSmartlot;
        const esPropio = Number(requestingUser.id) === Number(targetId);

        if (!esAdminOrSmartlot && !esPropio) {
            const error = new Error('No tiene permisos para modificar este usuario.');
            error.statusCode = 403;
            throw error;
        }

        if (esPropio) {
            delete entity.id_rol;
        }

        if (!esPropio && esAdmin && entity.id_rol !== undefined) {
            const targetRol = Number(entity.id_rol);
            if (![1, 2, 3].includes(targetRol)) {
                const error = new Error('Solo puede asignar los roles admin, empleado o garagista.');
                error.statusCode = 400;
                throw error;
            }
        }

        if (!esPropio && esAdmin && !esSmartlot) {
            delete entity.id_empresa;
        }

        if (!esAdminOrSmartlot) {
            delete entity.id_rol;
            delete entity.activo;
            delete entity.id_empresa;
        }
    }
}

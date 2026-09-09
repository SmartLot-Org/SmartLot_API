// solicitudRegistroService.js
import bcrypt from 'bcrypt';
import SolicitudRegistroRepository from '../repositories/solicitudRegistroRepository.js';
import UsuarioRepository from '../repositories/usuarioRepository.js';
import RolService from './rolService.js';
import { enviarCorreoDesdePlantilla } from './emailService.js';
import { isValidEmail, isValidPhone, isValidStrongPassword } from '../helpers/validatorHelper.js';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

const ESTADOS_VALIDOS = new Set(['pendiente', 'aceptada', 'rechazada']);
const PASSWORD_FUERTE_MESSAGE = 'La contraseña debe tener al menos 8 caracteres, 2 mayúsculas, 2 números y 2 caracteres especiales.';

export default class SolicitudRegistroService {
    constructor() {
        this.repo = new SolicitudRegistroRepository();
        this.usuarioRepo = new UsuarioRepository();
        this.rolService = new RolService();
    }

    createAsync = async (input) => {
        const nombre = String(input?.nombre ?? '').trim();
        const apellido = String(input?.apellido ?? '').trim();
        const email = String(input?.email ?? '').trim().toLowerCase();
        const telefono = input?.telefono === undefined || input?.telefono === null || String(input.telefono).trim() === ''
            ? null
            : String(input.telefono).trim();
        const contraseña = input?.contraseña;
        const empresaNombre = String(input?.empresa_nombre ?? '').trim();
        let empresaDescripcion = null;
        if (input?.empresa_descripcion !== undefined && input?.empresa_descripcion !== null) {
            if (typeof input.empresa_descripcion !== 'string') fail('La descripción de la empresa debe ser un texto.', 400);
            empresaDescripcion = input.empresa_descripcion.trim() || null;
            if (empresaDescripcion && empresaDescripcion.length > 1000) {
                fail('La descripción de la empresa no puede superar 1000 caracteres.', 400);
            }
        }
        if (!nombre) fail('El nombre es requerido.', 400);
        if (!apellido) fail('El apellido es requerido.', 400);
        if (!isValidEmail(email)) fail('El email no tiene un formato válido.', 400);
        if (telefono !== null && !isValidPhone(telefono)) fail('El teléfono debe contener solo dígitos (mínimo 7).', 400);
        if (!isValidStrongPassword(contraseña)) fail(PASSWORD_FUERTE_MESSAGE, 400);
        if (empresaNombre.length < 2) fail('El nombre de la empresa es requerido (mínimo 2 caracteres).', 400);

        // El estado y los enlaces con empresa/usuario SIEMPRE los decide el servidor, nunca el cliente.
        const existente = await this.usuarioRepo.getByEmailAsync(email);
        if (existente) fail(`Ya existe un usuario con el email ${email}.`, 409);
        if (await this.repo.hasPendingByEmailAsync(email)) fail('Ya existe una solicitud pendiente con ese email.', 409);

        const contraseña_hash = await bcrypt.hash(contraseña, BCRYPT_ROUNDS);
        return await this.repo.createPendingAsync({
            nombre,
            apellido,
            email,
            telefono,
            contraseña_hash,
            empresa_nombre: empresaNombre,
            empresa_descripcion: empresaDescripcion,
        });
    };

    getAllAsync = async (estado = null) => {
        const normalizado = estado === undefined || estado === null || estado === '' ? null : String(estado);
        if (normalizado !== null && !ESTADOS_VALIDOS.has(normalizado)) fail('El estado indicado no es válido.', 400);
        return await this.repo.getAllAsync(normalizado);
    };

    approveAsync = async (id, revisor) => {
        const rolAdmin = await this.rolService.getByIdAsync(1);
        if (!rolAdmin || String(rolAdmin.tipo_rol || '').toLowerCase() !== 'admin') {
            fail('Error de configuración: el rol de administrador no está disponible.', 500);
        }
        const resultado = await this.repo.approveAsync(id, { idRolAdmin: 1, idRevisor: revisor?.id ?? null });
        const nombreCompleto = `${resultado.usuario.nombre ?? ''} ${resultado.usuario.apellido ?? ''}`.trim() || 'Usuario';
        try {
            await enviarCorreoDesdePlantilla(resultado.usuario.email, 'bienvenida', { nombre: nombreCompleto, email: resultado.usuario.email });
        } catch (err) { console.error('Error al enviar correo de bienvenida:', err); }
        const { contraseña: _hash, ...usuarioSinContraseña } = resultado.usuario;
        return { ...resultado, usuario: usuarioSinContraseña };
    };

    rejectAsync = async (id, revisor) => await this.repo.rejectAsync(id, revisor?.id ?? null);
}

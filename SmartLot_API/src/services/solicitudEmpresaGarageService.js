import SolicitudEmpresaGarageRepository from '../repositories/solicitudEmpresaGarageRepository.js';
import { hasRole, ROLE_NAMES } from '../helpers/roles.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

export default class SolicitudEmpresaGarageService {
    constructor() { this.repo = new SolicitudEmpresaGarageRepository(); }

    createAsync = async (input, usuario) => {
        if (!hasRole(usuario, 1, ROLE_NAMES.ADMIN)) fail('Solo un administrador puede crear solicitudes.', 403);
        const idEmpresa = Number(usuario?.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) fail('El administrador no tiene una empresa válida.', 403);
        const idSede = Number(input.id_sede);
        const idGarage = Number(input.id_garage);
        const cantidad = Number(input.cantidad_cocheras);
        if (!Number.isInteger(idSede) || idSede <= 0) fail('id_sede debe ser un entero positivo.', 400);
        if (!Number.isInteger(idGarage) || idGarage <= 0) fail('id_garage debe ser un entero positivo.', 400);
        if (!Number.isInteger(cantidad) || cantidad <= 0) fail('cantidad_cocheras debe ser un entero mayor que cero.', 400);
        if (usuario.id_sede && Number(usuario.id_sede) !== idSede) fail('No puede crear solicitudes para otra sede.', 403);
        let descripcion = null;
        if (input.descripcion !== undefined && input.descripcion !== null) {
            if (typeof input.descripcion !== 'string') fail('descripcion debe ser un string.', 400);
            descripcion = input.descripcion.trim();
            if (descripcion.length > 1000) fail('descripcion no puede superar 1000 caracteres.', 400);
            if (!descripcion) descripcion = null;
        }
        return this.repo.createPendingAsync({
            id_sede: idSede,
            id_empresa_autorizada: idEmpresa,
            id_garage: idGarage,
            cantidad_cocheras: cantidad,
            descripcion,
        });
    };

    getSentAsync = async (usuario) => {
        if (!hasRole(usuario, 1, ROLE_NAMES.ADMIN)) fail('No tiene permisos para ver solicitudes enviadas.', 403);
        const idEmpresa = Number(usuario.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) fail('El administrador no tiene una empresa válida.', 403);
        return this.repo.getSentByEmpresaAsync(idEmpresa, usuario.id_sede ? Number(usuario.id_sede) : null);
    };

    getReceivedAsync = async (usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('No tiene permisos para ver solicitudes recibidas.', 403);
        return this.repo.getReceivedByOwnerAsync(Number(usuario.id));
    };

    getByIdAsync = async (id, usuario) => {
        const solicitud = await this.repo.getByIdAsync(id);
        if (!solicitud) fail('La solicitud no existe.', 404);
        if (hasRole(usuario, 4, ROLE_NAMES.SUPERADMIN)) return solicitud;
        if (hasRole(usuario, 1, ROLE_NAMES.ADMIN) && Number(usuario.id_empresa) === Number(solicitud.id_empresa) &&
            (!usuario.id_sede || Number(usuario.id_sede) === Number(solicitud.id_sede))) return solicitud;
        if (hasRole(usuario, ROLE_NAMES.DUENO_GARAGE) && await this.repo.ownerHasGarageAsync(usuario.id, solicitud.id_garage)) return solicitud;
        fail('No tiene acceso a esta solicitud.', 403);
    };

    acceptAsync = async (id, usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('Solo el dueño del garage puede aceptar solicitudes.', 403);
        return this.repo.acceptAsync(id, usuario.id);
    };

    rejectAsync = async (id, usuario) => {
        if (!hasRole(usuario, ROLE_NAMES.DUENO_GARAGE)) fail('Solo el dueño del garage puede rechazar solicitudes.', 403);
        return this.repo.rejectAsync(id, usuario.id);
    };

    cancelAsync = async (id, usuario) => {
        if (!hasRole(usuario, 1, ROLE_NAMES.ADMIN)) fail('Solo la empresa solicitante puede cancelar solicitudes.', 403);
        const idEmpresa = Number(usuario.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) fail('El administrador no tiene una empresa válida.', 403);
        return this.repo.cancelAsync(id, idEmpresa, usuario.id_sede ? Number(usuario.id_sede) : null);
    };
}

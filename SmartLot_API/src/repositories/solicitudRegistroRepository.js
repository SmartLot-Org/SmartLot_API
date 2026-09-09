// solicitudRegistroRepository.js
import pool from '../database/db.js';
import UsuarioRepository from './usuarioRepository.js';
import EmpresaRepository from './empresaRepository.js';
import { ESTADOS_SOLICITUD } from '../helpers/estadosSolicitud.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

export default class SolicitudRegistroRepository {
    constructor() {
        this.pool = pool;
        this.usuarioRepo = new UsuarioRepository();
        this.empresaRepo = new EmpresaRepository();
    }

    createPendingAsync = async (entity) => {
        const result = await this.pool.query(
            `INSERT INTO solicitudes_registro (nombre, apellido, email, telefono, contraseña_hash, empresa_nombre, empresa_descripcion, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [entity.nombre, entity.apellido, entity.email, entity.telefono,
             entity.contraseña_hash, entity.empresa_nombre, entity.empresa_descripcion,
             ESTADOS_SOLICITUD.PENDIENTE]
        );
        return result.rows[0];
    }

    hasPendingByEmailAsync = async (email) => (await this.pool.query(
        'SELECT id FROM solicitudes_registro WHERE email = $1 AND estado = $2 LIMIT 1',
        [email, ESTADOS_SOLICITUD.PENDIENTE]
    )).rowCount > 0;

    getAllAsync = async (estado = null) => (await this.pool.query(
        `SELECT * FROM solicitudes_registro
          WHERE ($1::text IS NULL OR estado = $1)
          ORDER BY created_at DESC`,
        [estado]
    )).rows;

    getByIdAsync = async (id) => (await this.pool.query(
        'SELECT * FROM solicitudes_registro WHERE id = $1', [id]
    )).rows[0] ?? null;

    approveAsync = async (id, { idRolAdmin, idRevisor }) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes_registro WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no esta pendiente.', 409);
            const existente = (await client.query(
                'SELECT id FROM usuarios WHERE email=$1 AND COALESCE("Borrado",false)=false LIMIT 1', [solicitud.email]
            )).rows[0];
            if (existente) fail(`Ya existe un usuario con el email ${solicitud.email}.`, 409);
            const empresa = await this.empresaRepo.createWithClientAsync({
                nombre: solicitud.empresa_nombre,
                descripcion: solicitud.empresa_descripcion,
            }, client);
            if (!empresa) fail('Error interno al crear la empresa.', 500);
            // La contraseña ya viaja hasheada desde la solicitud: se inserta tal cual, sin re-hashear.
            const usuario = await this.usuarioRepo.createWithClientAsync({
                id_rol: idRolAdmin,
                nombre: solicitud.nombre,
                apellido: solicitud.apellido,
                id_sede: null,
                email: solicitud.email,
                telefono: solicitud.telefono,
                contraseña: solicitud.contraseña_hash,
                id_empresa: empresa.id,
                activo: true,
                token_version: 0,
            }, client);
            const updated = await client.query(
                `UPDATE solicitudes_registro SET estado=$1, revisada_at=NOW(), revisada_por=$2
                  WHERE id=$3 AND estado=$4 RETURNING *`,
                [ESTADOS_SOLICITUD.ACEPTADA, idRevisor, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no esta pendiente.', 409);
            await client.query('COMMIT');
            return { solicitud: updated.rows[0], empresa, usuario };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') fail('Ya existe un usuario con ese email.', 409);
            throw error;
        } finally { client.release(); }
    };

    rejectAsync = async (id, idRevisor) => {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const solicitud = (await client.query('SELECT * FROM solicitudes_registro WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!solicitud) fail('La solicitud no existe.', 404);
            if (solicitud.estado !== ESTADOS_SOLICITUD.PENDIENTE) fail('La solicitud ya no esta pendiente.', 409);
            const updated = await client.query(
                `UPDATE solicitudes_registro SET estado=$1, revisada_at=NOW(), revisada_por=$2
                  WHERE id=$3 AND estado=$4 RETURNING *`,
                [ESTADOS_SOLICITUD.RECHAZADA, idRevisor, id, ESTADOS_SOLICITUD.PENDIENTE]
            );
            if (updated.rowCount !== 1) fail('La solicitud ya no esta pendiente.', 409);
            await client.query('COMMIT');
            return updated.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    };
}

// emailTemplateRepository.js
import pool from '../database/db.js';

const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

export default class EmailTemplateRepository {
    constructor() {
        this.pool = pool;
    }

    listAllAsync = async () => {
        try {
            const result = await pool.query(
                `SELECT id, codigo, nombre, descripcion, asunto, activa, updated_at, created_at
                 FROM email_templates
                 ORDER BY nombre`
            );
            return result.rows;
        } catch (error) { console.error(error); fail('Error al listar plantillas de email.', 500); }
    }

    getByCodigoAsync = async (codigo) => {
        try {
            const result = await pool.query(
                `SELECT * FROM email_templates WHERE codigo = $1`,
                [codigo]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); fail('Error al obtener la plantilla de email.', 500); }
    }

    updateAsync = async (codigo, datos) => {
        try {
            const result = await pool.query(
                `UPDATE email_templates
                 SET nombre = $2,
                     descripcion = $3,
                     asunto = $4,
                     header_html = $5,
                     cuerpo_html = $6,
                     footer_html = $7,
                     variables = $8,
                     activa = $9,
                     updated_at = NOW()
                 WHERE codigo = $1
                 RETURNING *`,
                [
                    codigo,
                    datos.nombre ?? null,
                    datos.descripcion ?? null,
                    datos.asunto ?? null,
                    datos.header_html ?? '',
                    datos.cuerpo_html ?? null,
                    datos.footer_html ?? '',
                    datos.variables ?? '[]',
                    datos.activa ?? true
                ]
            );
            return result.rows[0] ?? null;
        } catch (error) { console.error(error); fail('Error al actualizar la plantilla de email.', 500); }
    }
}
import pool from '../database/db.js';

const DETAIL_SELECT = `
  SELECT t.*, s.id_empresa AS id_empresa, e.nombre AS empresa_nombre,
    s.nombre AS sede_nombre, s.ubicacion AS sede_ubicacion,
    g.nombre AS garage_nombre, g.ubicacion AS garage_ubicacion, g.capacidad,
    g.estado AS garage_estado, g.hora_apertura, g.hora_cierre,
    COALESCE((SELECT array_agg(gd.dia::text ORDER BY gd.dia) FROM garage_dias gd WHERE gd.id_garage=g.id AND gd.activo=true), '{}'::text[]) AS dias
  FROM trato_empresa_garage t
  JOIN sedes s ON s.id=t.id_sede
  JOIN empresas e ON e.id=s.id_empresa
  JOIN garages g ON g.id=t.id_garage
  WHERE COALESCE(t."Borrado", false) = false`;

export default class TratoEmpresaGarageRepository {
    getAllAsync = async () => (await pool.query(`${DETAIL_SELECT} ORDER BY t.id`)).rows;
    getByIdAsync = async (id) => (await pool.query(`${DETAIL_SELECT} AND t.id=$1`, [id])).rows[0] ?? null;
    getByEmpresaAsync = async (idEmpresa, idSede = null) => (await pool.query(
        `${DETAIL_SELECT} AND s.id_empresa=$1 AND ($2::int IS NULL OR t.id_sede=$2) ORDER BY t.id`, [idEmpresa, idSede]
    )).rows;
    getByGarageAsync = async (idGarage) => (await pool.query(`${DETAIL_SELECT} AND t.id_garage=$1 ORDER BY t.id`, [idGarage])).rows;
    getByOwnerAsync = async (idUsuario) => (await pool.query(
        `${DETAIL_SELECT} AND EXISTS (
            SELECT 1 FROM usuario_garage ug WHERE ug.id_usuario=$1 AND ug.id_garage=t.id_garage
        ) ORDER BY t.id`, [idUsuario]
    )).rows;
    getBySedeGarageAsync = async (idSede, idGarage, excludeId = null) => (await pool.query(
        `SELECT * FROM trato_empresa_garage WHERE id_sede=$1 AND id_garage=$2 AND COALESCE("Borrado", false)=false AND ($3::int IS NULL OR id<>$3) LIMIT 1`,
        [idSede, idGarage, excludeId]
    )).rows[0] ?? null;

    getBySedeGarageWithClientAsync = async (idSede, idGarage, client) => {
        const result = await client.query(
            'SELECT * FROM trato_empresa_garage WHERE id_sede=$1 AND id_garage=$2 AND COALESCE("Borrado", false)=false LIMIT 1',
            [idSede, idGarage]
        );
        return result.rows[0] ?? null;
    };

    sumCantidadByGarageWithClientAsync = async (idGarage, client, excludeId = null) => {
        const result = await client.query(
            'SELECT COALESCE(SUM(cantidad_cocheras),0) AS total FROM trato_empresa_garage WHERE id_garage=$1 AND COALESCE("Borrado", false)=false AND ($2::int IS NULL OR id<>$2)',
            [idGarage, excludeId]
        );
        return Number(result.rows[0]?.total ?? 0);
    };

    createWithClientAsync = async (entity, client) => {
        const result = await client.query(
            `INSERT INTO trato_empresa_garage
                (id_sede,id_garage,cantidad_cocheras,precio_pickup,precio_auto,precio_moto,modalidad_pago)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [entity.id_sede, entity.id_garage, entity.cantidad_cocheras,
             entity.precio_pickup, entity.precio_auto, entity.precio_moto, entity.modalidad_pago]
        );
        return result.rows[0];
    };

    updatePaymentModalityAsync = async (id, modalidad, cambiadoPor) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const current = (await client.query(
                `SELECT t.*, s.id_empresa FROM trato_empresa_garage t
                 JOIN sedes s ON s.id=t.id_sede WHERE t.id=$1 AND COALESCE(t."Borrado", false)=false FOR UPDATE OF t`, [id]
            )).rows[0];
            if (!current) throw Object.assign(new Error('El trato no existe.'), { statusCode: 404 });
            if (current.modalidad_pago === modalidad) {
                await client.query('COMMIT');
                return { trato: current, changed: false };
            }
            const trato = (await client.query(
                'UPDATE trato_empresa_garage SET modalidad_pago=$1 WHERE id=$2 RETURNING *', [modalidad, id]
            )).rows[0];
            await client.query(
                `INSERT INTO historial_modalidad_trato
                    (id_trato, modalidad_anterior, modalidad_nueva, cambiado_por)
                 VALUES ($1,$2,$3,$4)`,
                [id, current.modalidad_pago, modalidad, cambiadoPor]
            );
            await client.query('COMMIT');
            return { trato: { ...trato, id_empresa: current.id_empresa }, changed: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    };

    createAgreementAsync = async (entity) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const sede = (await client.query(
                `SELECT id, id_empresa FROM sedes WHERE id=$1 AND COALESCE("Borrado",false)=false`, [entity.id_sede]
            )).rows[0];
            if (!sede) throw Object.assign(new Error('La sede no existe o esta inactiva.'), { statusCode: 404 });
            const garage = (await client.query(
                'SELECT * FROM garages WHERE id=$1 AND COALESCE("Borrado",false)=false FOR UPDATE', [entity.id_garage]
            )).rows[0];
            if (!garage) throw Object.assign(new Error('El garage no existe.'), { statusCode: 404 });
            const occupied = Number((await client.query(
                'SELECT COALESCE(SUM(cantidad_cocheras),0) AS total FROM trato_empresa_garage WHERE id_garage=$1 AND COALESCE("Borrado", false)=false', [entity.id_garage]
            )).rows[0].total);
            if (occupied + entity.cantidad_cocheras > Number(garage.capacidad)) {
                throw Object.assign(new Error('La suma de cocheras contratadas supera la capacidad total del garage.'), { statusCode: 409 });
            }
            const result = await client.query(
                `INSERT INTO trato_empresa_garage (id_sede,id_garage,cantidad_cocheras,precio_pickup,precio_auto,precio_moto,modalidad_pago)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [entity.id_sede, entity.id_garage, entity.cantidad_cocheras,
                 Number(garage.precio_pickup ?? 0), Number(garage.precio_auto ?? 0), Number(garage.precio_moto ?? 0), entity.modalidad_pago]
            );
            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') throw Object.assign(new Error('Ya existe un trato para esa sede y garage.'), { statusCode: 409 });
            throw error;
        } finally { client.release(); }
    };

    updateQuantityAsync = async (id, cantidad) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const current = (await client.query('SELECT * FROM trato_empresa_garage WHERE id=$1 AND COALESCE("Borrado", false)=false FOR UPDATE', [id])).rows[0];
            if (!current) throw Object.assign(new Error('El trato no existe.'), { statusCode: 404 });
            const garage = (await client.query('SELECT capacidad FROM garages WHERE id=$1 FOR UPDATE', [current.id_garage])).rows[0];
            const others = Number((await client.query(
                'SELECT COALESCE(SUM(cantidad_cocheras),0) total FROM trato_empresa_garage WHERE id_garage=$1 AND id<>$2 AND COALESCE("Borrado", false)=false',
                [current.id_garage, id]
            )).rows[0].total);
            if (others + cantidad > Number(garage.capacidad)) {
                throw Object.assign(new Error('La suma de cocheras contratadas supera la capacidad total del garage.'), { statusCode: 409 });
            }
            const row = (await client.query(
                'UPDATE trato_empresa_garage SET cantidad_cocheras=$1 WHERE id=$2 RETURNING *', [cantidad, id]
            )).rows[0];
            await client.query('COMMIT');
            return row;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };

    softDeleteAsync = async (id) => (await pool.query(
        'UPDATE trato_empresa_garage SET "Borrado" = true WHERE id=$1 AND COALESCE("Borrado", false)=false RETURNING id',
        [id]
    )).rowCount > 0;
}

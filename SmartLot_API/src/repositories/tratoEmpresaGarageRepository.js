import pool from '../database/db.js';

const DETAIL_SELECT = `
  SELECT t.*, s.nombre AS sede_nombre, s.ubicacion AS sede_ubicacion,
    g.nombre AS garage_nombre, g.ubicacion AS garage_ubicacion, g.capacidad,
    g.estado AS garage_estado, g.hora_apertura, g.hora_cierre,
    COALESCE((SELECT array_agg(gd.dia::text ORDER BY gd.dia) FROM garage_dias gd WHERE gd.id_garage=g.id AND gd.activo=true), '{}'::text[]) AS dias
  FROM trato_empresa_garage t
  JOIN garages g ON g.id=t.id_garage
  LEFT JOIN sedes s ON s.id=t.id_sede`;

export default class TratoEmpresaGarageRepository {
    getAllAsync = async () => (await pool.query(`${DETAIL_SELECT} ORDER BY t.id`)).rows;
    getByIdAsync = async (id) => (await pool.query(`${DETAIL_SELECT} WHERE t.id=$1`, [id])).rows[0] ?? null;
    getByEmpresaAsync = async (idEmpresa, idSede = null) => (await pool.query(
        `${DETAIL_SELECT} WHERE t.id_empresa=$1 AND ($2::int IS NULL OR t.id_sede=$2) ORDER BY t.id`, [idEmpresa, idSede]
    )).rows;
    getByGarageAsync = async (idGarage) => (await pool.query(`${DETAIL_SELECT} WHERE t.id_garage=$1 ORDER BY t.id`, [idGarage])).rows;
    getBySedeGarageAsync = async (idSede, idGarage, excludeId = null) => (await pool.query(
        `SELECT * FROM trato_empresa_garage WHERE id_sede=$1 AND id_garage=$2 AND ($3::int IS NULL OR id<>$3) LIMIT 1`,
        [idSede, idGarage, excludeId]
    )).rows[0] ?? null;

    getByEmpresaGarageWithClientAsync = async (idEmpresa, idGarage, client) => {
        const result = await client.query(
            'SELECT * FROM trato_empresa_garage WHERE id_empresa=$1 AND id_garage=$2 LIMIT 1',
            [idEmpresa, idGarage]
        );
        return result.rows[0] ?? null;
    };

    sumCantidadByGarageWithClientAsync = async (idGarage, client) => {
        const result = await client.query(
            'SELECT COALESCE(SUM(cantidad_cocheras),0) AS total FROM trato_empresa_garage WHERE id_garage=$1',
            [idGarage]
        );
        return Number(result.rows[0]?.total ?? 0);
    };

    createWithClientAsync = async (entity, client) => {
        const result = await client.query(
            `INSERT INTO trato_empresa_garage
                (id_empresa,id_sede,id_garage,cantidad_cocheras,precio_pickup,precio_auto,precio_moto)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [entity.id_empresa, entity.id_sede ?? null, entity.id_garage, entity.cantidad_cocheras,
             entity.precio_pickup, entity.precio_auto, entity.precio_moto]
        );
        return result.rows[0];
    };

    createAgreementAsync = async (entity) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const garage = (await client.query(
                'SELECT * FROM garages WHERE id=$1 AND COALESCE("Borrado",false)=false FOR UPDATE', [entity.id_garage]
            )).rows[0];
            if (!garage) throw Object.assign(new Error('El garage no existe.'), { statusCode: 404 });
            const occupied = Number((await client.query(
                'SELECT COALESCE(SUM(cantidad_cocheras),0) AS total FROM trato_empresa_garage WHERE id_garage=$1', [entity.id_garage]
            )).rows[0].total);
            if (occupied + entity.cantidad_cocheras > Number(garage.capacidad)) {
                throw Object.assign(new Error('La suma de cocheras contratadas supera la capacidad total del garage.'), { statusCode: 409 });
            }
            const result = await client.query(
                `INSERT INTO trato_empresa_garage (id_empresa,id_sede,id_garage,cantidad_cocheras,precio_pickup,precio_auto,precio_moto)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [entity.id_empresa, entity.id_sede, entity.id_garage, entity.cantidad_cocheras,
                 Number(garage.precio_pickup ?? 0), Number(garage.precio_auto ?? 0), Number(garage.precio_moto ?? 0)]
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
            const current = (await client.query('SELECT * FROM trato_empresa_garage WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!current) throw Object.assign(new Error('El trato no existe.'), { statusCode: 404 });
            const garage = (await client.query('SELECT capacidad FROM garages WHERE id=$1 FOR UPDATE', [current.id_garage])).rows[0];
            const others = Number((await client.query(
                'SELECT COALESCE(SUM(cantidad_cocheras),0) total FROM trato_empresa_garage WHERE id_garage=$1 AND id<>$2',
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

    deleteAsync = async (id) => (await pool.query('DELETE FROM trato_empresa_garage WHERE id=$1 RETURNING id', [id])).rowCount > 0;
}

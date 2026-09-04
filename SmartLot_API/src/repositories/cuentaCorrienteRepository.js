import pool from '../database/db.js';

export default class CuentaCorrienteRepository {
    crearConsumoReservaAsync = async (idReserva, client) => {
        const result = await client.query(
            `WITH datos AS (
                SELECT r.id AS id_reserva,
                       r.id_trato,
                       u.id_sede,
                       u.id_empresa,
                       r.id_garage,
                       v.tipo_vehiculo,
                       r.fecha_entrada AS fecha_inicio,
                       r.fecha_salida AS fecha_fin,
                       ROUND(EXTRACT(EPOCH FROM (r.fecha_salida - r.fecha_entrada)) / 60.0)::integer AS minutos_facturados,
                       r.tarifa_hora_aplicada,
                       r.modalidad_pago_aplicada,
                       r.tipo_cupo,
                       r.responsable_pago
                  FROM reservas r
                  JOIN usuarios u ON u.id = r.id_usuario
                  JOIN vehiculos v ON v.id = r.id_vehiculo
                 WHERE r.id = $1
                   AND r.entro = true
                   AND r.salio = true
                   AND COALESCE(r."Borrado", false) = false
                   AND r.estado_reserva = 'confirmada'
                   AND r.fecha_salida > r.fecha_entrada
            ), insertado AS (
                INSERT INTO consumos_reserva
                    (id_reserva, id_trato, id_sede, id_empresa, id_garage,
                     tipo_vehiculo, fecha_inicio, fecha_fin, minutos_facturados,
                     tarifa_hora_aplicada, importe_generado, modalidad_pago_aplicada,
                     tipo_cupo, responsable_pago)
                SELECT id_reserva, id_trato, id_sede, id_empresa, id_garage,
                       tipo_vehiculo, fecha_inicio, fecha_fin, minutos_facturados,
                       tarifa_hora_aplicada,
                       ROUND(tarifa_hora_aplicada * minutos_facturados / 60.0, 2),
                       modalidad_pago_aplicada, tipo_cupo, responsable_pago
                  FROM datos
                 WHERE tarifa_hora_aplicada IS NOT NULL
                   AND tarifa_hora_aplicada >= 0
                ON CONFLICT (id_reserva) DO NOTHING
                RETURNING *
            )
            SELECT * FROM insertado
            UNION ALL
            SELECT c.* FROM consumos_reserva c
             WHERE c.id_reserva = $1 AND NOT EXISTS (SELECT 1 FROM insertado)
            LIMIT 1`,
            [idReserva]
        );
        return result.rows[0] ?? null;
    };

    getAdminAsync = async ({ idEmpresa, idSede = null, periodo = null, search = null }) => {
        const result = await pool.query(
            `SELECT c.id, c.id_reserva, c.id_garage, g.nombre AS garage,
                    c.id_sede, s.nombre AS sede,
                    to_char(c.fecha_inicio, 'YYYY-MM') AS periodo,
                    c.fecha_inicio, c.fecha_fin, c.tipo_vehiculo::text AS tipo_vehiculo,
                    c.minutos_facturados, c.tarifa_hora_aplicada, c.importe_generado,
                    c.responsable_pago::text AS responsable_pago
               FROM consumos_reserva c
               JOIN garages g ON g.id = c.id_garage
               JOIN sedes s ON s.id = c.id_sede
              WHERE c.id_empresa = $1
                AND c.responsable_pago = 'empresa'
                AND ($2::integer IS NULL OR c.id_sede = $2)
                AND ($3::text IS NULL OR c.fecha_inicio >= ($3 || '-01')::date
                     AND c.fecha_inicio < (($3 || '-01')::date + INTERVAL '1 month'))
                AND ($4::text IS NULL OR g.nombre ILIKE '%' || $4 || '%'
                     OR s.nombre ILIKE '%' || $4 || '%')
              ORDER BY c.fecha_inicio DESC, c.id DESC`,
            [idEmpresa, idSede, periodo, search]
        );
        return result.rows;
    };

    getPagosAprobadosPorEmpresaAsync = async (idEmpresa) => {
        // Trae pagos approved para marcar consumos como PAGADA
        // Incluye id_reserva directo y metadata.consumos_ids para pagos de grupo
        try {
            const result = await pool.query(
                `SELECT id, id_reserva, id_orden_externa, mp_payment_id, mp_payment_status, monto, metadata
                   FROM pagos
                  WHERE id_empresa = $1
                    AND mp_payment_status = 'approved'`,
                [idEmpresa]
            );
            return result.rows;
        } catch (e) {
            // Si tabla pagos no existe aún, retornar vacío sin romper cuentas corrientes
            if (e.code === '42P01') return [];
            throw e;
        }
    };

    getDuenoAsync = async ({ idUsuario, idGarage = null, periodo = null, search = null }) => {
        const result = await pool.query(
            `SELECT c.id, c.id_reserva, c.id_empresa, e.nombre AS empresa,
                    c.id_garage, g.nombre AS garage, c.id_sede, s.nombre AS sede,
                    to_char(c.fecha_inicio, 'YYYY-MM') AS periodo,
                    c.fecha_inicio, c.fecha_fin, c.tipo_vehiculo::text AS tipo_vehiculo,
                    c.minutos_facturados, c.tarifa_hora_aplicada, c.importe_generado,
                    c.responsable_pago::text AS responsable_pago
               FROM consumos_reserva c
               JOIN empresas e ON e.id = c.id_empresa
               JOIN garages g ON g.id = c.id_garage
               JOIN sedes s ON s.id = c.id_sede
              WHERE EXISTS (
                    SELECT 1 FROM usuario_garage ug
                     WHERE ug.id_usuario = $1 AND ug.id_garage = c.id_garage
                )
                AND ($2::integer IS NULL OR c.id_garage = $2)
                AND ($3::text IS NULL OR c.fecha_inicio >= ($3 || '-01')::date
                     AND c.fecha_inicio < (($3 || '-01')::date + INTERVAL '1 month'))
                AND ($4::text IS NULL OR e.nombre ILIKE '%' || $4 || '%'
                     OR s.nombre ILIKE '%' || $4 || '%' OR g.nombre ILIKE '%' || $4 || '%')
              ORDER BY c.fecha_inicio DESC, c.id DESC`,
            [idUsuario, idGarage, periodo, search]
        );
        return result.rows;
    };
}

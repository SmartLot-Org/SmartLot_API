import CuentaCorrienteRepository from '../repositories/cuentaCorrienteRepository.js';

const fail = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
};

const money = (value) => Number(Number(value).toFixed(2));

export default class CuentaCorrienteService {
    constructor() {
        this.repo = new CuentaCorrienteRepository();
    }

    getAdminAsync = async (filters, usuario) => {
        const idEmpresa = Number(usuario?.id_empresa);
        if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
            fail('El usuario no tiene una empresa autorizada.', 403);
        }

        const periodo = filters.periodo?.trim() || null;
        if (periodo && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
            fail('periodo debe tener formato YYYY-MM.', 400);
        }

        let idSede = null;
        if (filters.id_sede !== undefined && filters.id_sede !== '') {
            idSede = Number(filters.id_sede);
            if (!Number.isInteger(idSede) || idSede <= 0) fail('id_sede debe ser un entero positivo.', 400);
        }
        if (usuario.id_sede && idSede && Number(usuario.id_sede) !== idSede) {
            fail('No puede consultar consumos de otra sede.', 403);
        }
        if (usuario.id_sede) idSede = Number(usuario.id_sede);

        const search = filters.search?.trim() || null;
        if (search && search.length > 100) fail('search no puede superar 100 caracteres.', 400);

        const rows = await this.repo.getAdminAsync({ idEmpresa, idSede, periodo, search });

        // Obtener pagos aprobados para determinar estado PAGADA/PENDIENTE
        // Se vincula por id_reserva directo y por metadata.consumos_ids (pagos de grupo) y por id_orden_externa pattern ADMIN-PAGO-periodo-G*-S*
        let pagosAprobados = [];
        try {
            pagosAprobados = await this.repo.getPagosAprobadosPorEmpresaAsync(idEmpresa);
        } catch {}

        const reservaPagadaSet = new Set();
        const consumoPagadoSet = new Set();
        const grupoPagadoSet = new Set(); // key = periodo:Gx:Sx

        for (const p of pagosAprobados) {
            if (p.id_reserva) reservaPagadaSet.add(Number(p.id_reserva));
            // metadata puede venir como string o objeto según driver
            let meta = p.metadata;
            if (typeof meta === 'string') {
                try { meta = JSON.parse(meta); } catch { meta = {}; }
            }
            if (meta && Array.isArray(meta.consumos_ids)) {
                for (const cid of meta.consumos_ids) consumoPagadoSet.add(Number(cid));
            }
            // También considerar pagos que fueron stringificados completos desde MP (metadata contiene paymentData)
            // Por compatibilidad, si el metadata interno tiene consumos_ids anidado
            if (meta && meta.consumos_ids) {
                const arr = Array.isArray(meta.consumos_ids) ? meta.consumos_ids : [];
                for (const cid of arr) consumoPagadoSet.add(Number(cid));
            }
            // Detectar pagos de grupo por id_orden_externa: ADMIN-PAGO-YYYY-MM-Gx-Sx-*
            if (p.id_orden_externa && p.id_orden_externa.startsWith('ADMIN-PAGO-')) {
                // formato: ADMIN-PAGO-2025-08-G3-S2-...  -> extraer periodo y G/S
                const m = String(p.id_orden_externa).match(/ADMIN-PAGO-(\d{4}-\d{2})-G(\d+)-S(\d+)/);
                if (m) {
                    const [, per, g, s] = m;
                    grupoPagadoSet.add(`${g}:${s}:${per}`);
                }
                // También soportar formato legacy: ADMIN-PAGO-YYYY-MM-Gx-Sy-TEST-xxxx
            }
        }

        const isConsumoPagado = (row) => {
            if (reservaPagadaSet.has(Number(row.id_reserva))) return true;
            if (consumoPagadoSet.has(Number(row.id))) return true;
            const gkey = `${row.id_garage}:${row.id_sede}:${row.periodo}`;
            if (grupoPagadoSet.has(gkey)) return true;
            return false;
        };

        const groups = new Map();
        for (const row of rows) {
            const key = `${row.id_garage}:${row.id_sede}:${row.periodo}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    idGarage: row.id_garage,
                    garage: row.garage,
                    idSede: row.id_sede,
                    sede: row.sede,
                    periodo: row.periodo,
                    reservasUtilizadas: 0,
                    minutosTotales: 0,
                    importeGenerado: 0,
                    movimientos: [],
                    _pagados: 0,
                });
            }
            const group = groups.get(key);
            const importe = money(row.importe_generado);
            group.reservasUtilizadas += 1;
            group.minutosTotales += Number(row.minutos_facturados);
            group.importeGenerado = money(group.importeGenerado + importe);
            const pagado = isConsumoPagado(row);
            if (pagado) group._pagados += 1;
            group.movimientos.push({
                idConsumo: Number(row.id),
                idReserva: row.id_reserva,
                garage: row.garage,
                sede: row.sede,
                fechaInicio: row.fecha_inicio,
                fechaFin: row.fecha_fin,
                tipoVehiculo: row.tipo_vehiculo,
                minutosUtilizados: Number(row.minutos_facturados),
                tarifaHoraAplicada: money(row.tarifa_hora_aplicada),
                importeGenerado: importe,
                pagado,
            });
        }

        const items = [...groups.values()].map((g) => {
            const estadoPago = g._pagados === g.reservasUtilizadas && g.reservasUtilizadas > 0 ? 'PAGADA' : 'PENDIENTE';
            const { _pagados, ...rest } = g;
            return { ...rest, estadoPago, pagados: _pagados };
        });
        const summary = items.reduce((acc, item) => ({
            reservasUtilizadas: acc.reservasUtilizadas + item.reservasUtilizadas,
            minutosTotales: acc.minutosTotales + item.minutosTotales,
            importeGenerado: money(acc.importeGenerado + item.importeGenerado),
        }), { reservasUtilizadas: 0, minutosTotales: 0, importeGenerado: 0 });
        return { items, summary };
    };

    getDuenoAsync = async (filters, usuario) => {
        const idUsuario = Number(usuario?.id);
        if (!Number.isInteger(idUsuario) || idUsuario <= 0) fail('Usuario no autorizado.', 403);
        const periodo = filters.periodo?.trim() || null;
        if (periodo && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) fail('periodo debe tener formato YYYY-MM.', 400);
        let idGarage = null;
        if (filters.id_garage !== undefined && filters.id_garage !== '') {
            idGarage = Number(filters.id_garage);
            if (!Number.isInteger(idGarage) || idGarage <= 0) fail('id_garage debe ser un entero positivo.', 400);
        }
        const search = filters.search?.trim() || null;
        if (search && search.length > 100) fail('search no puede superar 100 caracteres.', 400);
        const rows = await this.repo.getDuenoAsync({ idUsuario, idGarage, periodo, search });
        const groups = new Map();
        for (const row of rows) {
            const key = `${row.id_empresa}:${row.id_sede}:${row.id_garage}:${row.periodo}`;
            if (!groups.has(key)) groups.set(key, {
                idEmpresa: row.id_empresa, empresa: row.empresa, idSede: row.id_sede, sede: row.sede,
                idGarage: row.id_garage, garage: row.garage, periodo: row.periodo,
                reservasUtilizadas: 0, minutosTotales: 0, importeGenerado: 0, movimientos: [],
            });
            const group = groups.get(key);
            const importe = money(row.importe_generado);
            group.reservasUtilizadas += 1;
            group.minutosTotales += Number(row.minutos_facturados);
            group.importeGenerado = money(group.importeGenerado + importe);
            group.movimientos.push({ idConsumo: Number(row.id), idReserva: row.id_reserva, fechaInicio: row.fecha_inicio,
                fechaFin: row.fecha_fin, tipoVehiculo: row.tipo_vehiculo, minutosUtilizados: Number(row.minutos_facturados),
                tarifaHoraAplicada: money(row.tarifa_hora_aplicada), importeGenerado: importe });
        }
        const items = [...groups.values()];
        const summary = items.reduce((acc, item) => ({ reservasUtilizadas: acc.reservasUtilizadas + item.reservasUtilizadas,
            minutosTotales: acc.minutosTotales + item.minutosTotales, importeGenerado: money(acc.importeGenerado + item.importeGenerado) }),
        { reservasUtilizadas: 0, minutosTotales: 0, importeGenerado: 0 });
        return { items, summary };
    };
}

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
                });
            }
            const group = groups.get(key);
            const importe = money(row.importe_generado);
            group.reservasUtilizadas += 1;
            group.minutosTotales += Number(row.minutos_facturados);
            group.importeGenerado = money(group.importeGenerado + importe);
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
            });
        }

        const items = [...groups.values()];
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
                reservasUtilizadas: 0, minutosTotales: 0, importeGenerado: 0,
                importeEmpresas: 0, importeEmpleados: 0, movimientos: [],
            });
            const group = groups.get(key);
            const importe = money(row.importe_generado);
            group.reservasUtilizadas += 1;
            group.minutosTotales += Number(row.minutos_facturados);
            group.importeGenerado = money(group.importeGenerado + importe);
            if (row.responsable_pago === 'empresa') group.importeEmpresas = money(group.importeEmpresas + importe);
            else group.importeEmpleados = money(group.importeEmpleados + importe);
            group.movimientos.push({ idConsumo: Number(row.id), idReserva: row.id_reserva, fechaInicio: row.fecha_inicio,
                fechaFin: row.fecha_fin, tipoVehiculo: row.tipo_vehiculo, minutosUtilizados: Number(row.minutos_facturados),
                tarifaHoraAplicada: money(row.tarifa_hora_aplicada), importeGenerado: importe,
                responsablePago: row.responsable_pago });
        }
        const items = [...groups.values()];
        const summary = items.reduce((acc, item) => ({ reservasUtilizadas: acc.reservasUtilizadas + item.reservasUtilizadas,
            minutosTotales: acc.minutosTotales + item.minutosTotales, importeGenerado: money(acc.importeGenerado + item.importeGenerado),
            importeEmpresas: money(acc.importeEmpresas + item.importeEmpresas), importeEmpleados: money(acc.importeEmpleados + item.importeEmpleados) }),
        { reservasUtilizadas: 0, minutosTotales: 0, importeGenerado: 0, importeEmpresas: 0, importeEmpleados: 0 });
        return { items, summary };
    };
}

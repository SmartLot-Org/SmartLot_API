# Cuentas corrientes (consumos generados)

`GET /api/cuentas-corrientes/admin?periodo=YYYY-MM&id_sede=&search=` requiere autenticación y rol administrador. La empresa se obtiene únicamente de `req.usuario.id_empresa`; si el administrador está asociado a una sede, la API fuerza esa sede.

La respuesta estable contiene `items` agrupados por garage, sede y período, con `reservasUtilizadas`, `minutosTotales`, `importeGenerado` y `movimientos`. Cada movimiento expone `idConsumo`, `idReserva`, `garage`, `sede`, `fechaInicio`, `fechaFin`, `tipoVehiculo`, `minutosUtilizados`, `tarifaHoraAplicada` e `importeGenerado`.

Un período sin consumos responde `200`:

```json
{
  "items": [],
  "summary": {
    "reservasUtilizadas": 0,
    "minutosTotales": 0,
    "importeGenerado": 0
  }
}
```

Los registros se crean en la transacción de check-out sólo para reservas con `entro = true`, `salio = true` y `Borrado = false`. La restricción única sobre `id_reserva` y `ON CONFLICT DO NOTHING` hacen idempotente la operación. Los valores guardados son snapshots y no se recalculan al consultar.

`GET /api/cuentas-corrientes/dueno?periodo=YYYY-MM&id_garage=&search=` requiere el rol `dueño_garage`. Devuelve consumos agrupados por empresa, sede, garage y período, y limita los resultados exclusivamente a garages relacionados con el usuario autenticado mediante `usuario_garage`.

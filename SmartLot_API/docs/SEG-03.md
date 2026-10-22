# SEG-03: importe y cobertura de pagos empresariales

## Causa y alcance

El navegador construía precio, referencia y consumos; el prefijo ADMIN-PAGO habilitaba un cobro artificial incluso fuera de sandbox. La cuenta corriente reconocía metadata no autorizada y un regex que saldaba grupos completos, incluidos consumos posteriores.

Se conserva SEG-01/SEG-02. No se modifican tarifas, tratos, rutas de lectura autorizada ni el mecanismo de reembolsos manuales. No se implementa SEG-04.

## Contrato

`POST /api/payments/preference`, autenticado:

```json
{
  "consumosIds": [123, 124],
  "idSede": 12,
  "idGarage": 3,
  "periodo": "2026-10",
  "backUrls": {
    "success": "https://frontend.example/admin/pagos",
    "failure": "https://frontend.example/admin/pagos",
    "pending": "https://frontend.example/admin/pagos"
  }
}
```

Solo `consumosIds` es obligatorio para empresa (1 a 1000 entradas; IDs repetidos se normalizan). Los filtros opcionales deben ser compatibles con todos los consumos. Empresa y restricción de sede salen de `req.usuario`. Un admin no puede sustituir su empresa con `idEmpresa`. Superadmin debe enviar `idEmpresa`; su contexto se valida resolviendo consumos y sedes de esa empresa en SQL. Dueño y garagista reciben 403; empleado solo puede usar `{ "idReserva": 123 }` para una reserva propia pendiente, con su importe persistido.

La respuesta empresarial 201 contiene `preferenceId`, `orderId`, `amount`, `currency`, `consumosIds`, `initPoint`, `sandboxInitPoint` y `sandbox`. La referencia es `EMP-<uuid>` generada por el servidor. Se mantienen las URLs de retorno. El frontend usa el importe y la referencia devueltos.

`items`, `unit_price`, `orderId`, `metadata`, `importe_original`, `importe_cobrado`, `test`, queries y headers del cliente no determinan el precio ni las asociaciones. El contrato anterior de items arbitrarios queda deshabilitado, también para superadmin. No se conserva un creador manual de diagnóstico; el formulario histórico de superadmin ya no puede crear esos pagos.

Selección inválida: 400. Rol/consumos/contexto no autorizados: 403. Saldo cero, orden superpuesta o regularización pendiente: 409, sin crear preferencia. El flujo de reserva del empleado conserva su respuesta existente.

## Cálculo y persistencia

Se resuelven y bloquean los consumos seleccionados en orden de ID mediante SQL, con empresa, sede y responsable histórico `empresa`. Se usa exclusivamente `consumos_reserva.importe_generado`, convertido de decimal a centavos `BigInt`; no se consulta el precio o modalidad actual del trato. Se excluyen consumos con cobertura verificada y los de importe cero. El saldo positivo se suma en centavos antes de convertirlo al número requerido por el SDK.

`enterprise_payment_orders` conserva referencia, empresa, restricción de sede, importe esperado, moneda, preferencia, pago del proveedor y evidencia de verificación. `enterprise_payment_consumptions` conserva el conjunto exacto y el importe individual. Los triggers impiden modificar expectativa, preferencia ya asignada y asociaciones. RLS y revocaciones impiden acceder desde roles del navegador.

La orden, asociaciones y fila local de `pagos` se confirman antes de contactar al proveedor. Una PK por consumo impide obligaciones superpuestas, aun ante otra implementación que no respete el bloqueo. Una solicitud concurrente o repetida con consumos pendientes recibe 409. No se crea una segunda preferencia para reintentar un timeout. Los consumos ya saldados de una selección desactualizada se excluyen; si no queda importe, se devuelve 409.

La expectativa nunca se sobrescribe con el importe recibido del proveedor. Su metadata se conserva como evidencia separada y no reemplaza las asociaciones locales.

## Reconocimiento y devoluciones

Webhook y sincronización autorizada utilizan `syncEnterprisePayment` con datos consultados a Mercado Pago simulado en pruebas. La correlación reutiliza `providerPaymentMatchesLocal`: referencia y preferencia, o merchant order con referencia, preferencia e identidad del pago. Solo estado `approved`, moneda exacta, importe exacto y evidencia consistente de ausencia de reembolsos permiten `settled=true`.

La cuenta corriente consulta exclusivamente asociaciones persistidas con esa verificación y un pago local aprobado. No reconoce metadata histórica ni referencias con regex ni una reserva del empleado como pago empresarial. Un consumo nuevo del mismo grupo permanece pendiente.

Reembolsos, contracargos, evidencia ausente o contradictoria dejan el conjunto sin cobertura total. Se conserva la primera evidencia de reversión; una respuesta posterior vieja no puede restaurar automáticamente el saldo pagado. Los reembolsos manuales de SEG-01 también invalidan cobertura mediante estado local y `lastRefundId`. No se inventa una distribución de devoluciones parciales: la orden queda para regularización y sus consumos no admiten otro cobro automático.

`importePendiente` representa importes históricos sin cobertura total verificable. Ante una reversión parcial no representa una deuda neta exigible ni una imputación de la devolución. `requiereRegularizacion` bloquea el botón de nuevo cobro. El resumen generado conserva el total histórico.

## Sandbox e históricos

Sandbox conserva el importe completo. Solo cambian credenciales/instrumentos y URL de checkout; ningún prefijo o flag del cliente habilita descuentos.

No se borran ni reescriben pagos históricos para simular cobertura. La vista restringida `enterprise_payments_pending_regularization` identifica pagos sin una orden empresarial verificable (excluye reservas individuales). Incluye los históricos de diez centavos o con metadata ambigua. Es un inventario conservador para revisión administrativa; no autoriza imputaciones ni asigna períodos por prefijo:

```sql
SELECT * FROM enterprise_payments_pending_regularization;
SELECT reference, review_reason, expected_amount, currency, verified_at
FROM enterprise_payment_orders
WHERE NOT settled;
```

## Migración y despliegue

Archivo: `migrations/20261022123341_seg03_enterprise_payment_orders.sql`, creado con CLI y ubicado según la convención existente del repositorio. Requiere tablas actuales de empresas, sedes, consumos y pagos; PostgreSQL 15+ para la vista con `security_invoker`. No agrega datos de prueba ni modifica datos históricos.

Aplicar una sola vez con el mecanismo habitual de migraciones, **antes de habilitar este backend**. Ejemplo para una base de staging seleccionada explícitamente, desde la carpeta backend:

```sh
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20261022123341_seg03_enterprise_payment_orders.sql
```

El rol PostgreSQL del backend debe poder operar las tablas con RLS (como la conexión privilegiada ya usada por la API); los roles `anon` y `authenticated` no reciben políticas ni acceso. Verificar la migración en staging y desplegar backend y frontend coordinadamente. No ejecutar migraciones antiguas de seed de pagos de prueba para preparar este cambio.

En esta tarea la migración se ejecutó solamente en PGlite en memoria. No se hicieron cobros, reembolsos ni escrituras en producción.

## Validación

Se ejecutaron las cinco suites solicitadas y `enterprise-payment-sql.integration.test.js`: **101 pruebas, 101 aprobadas, 0 fallidas, 0 omitidas** (71 regresiones y 30 nuevas). Las cuatro pruebas del contrato vulnerable de creación libre se reemplazaron por rechazo del endpoint anterior y pruebas SQL del contrato seguro; se conservaron permisos, correlación y regresiones de reembolso.

La suite nueva ejecuta SQL real de autorización, selección, persistencia, triggers y reconocimiento en PGlite; solo Mercado Pago está simulado. Comprueba precios manipulados, contexto/roles, responsable histórico, cambios de trato, duplicados, cero, pagos ya cubiertos, moneda/importe/preferencia incorrectos, merchant order, nuevos consumos, repetición, concurrencia, históricos y reversiones. PGlite ofrece una conexión: el adaptador serializa las transacciones de solicitudes concurrentes; se ejercitan SQL y unicidad, no bloqueos entre procesos PostgreSQL separados.

`npm run check:syntax` y `npm run check:routes`: aprobados. Adicionalmente, las 7 pruebas de cuentas corrientes pasaron.

Frontend: `npm test`, **119 aprobadas**, incluidos dos contratos nuevos; lint dirigido sin errores (una advertencia preexistente de dependencias de `useEffect`); `npm run build` aprobado (advertencia de tamaño de chunks).

## Archivos

Backend:

- `src/controllers/paymentController.js`
- `src/services/enterprisePaymentService.js`
- `src/services/paymentReadService.js`
- `src/services/cuentaCorrienteService.js`
- `src/repositories/cuentaCorrienteRepository.js`
- `migrations/20261022123341_seg03_enterprise_payment_orders.sql`
- `test/enterprise-payment-sql.integration.test.js`
- `test/mp-controller.test.js`
- `test/payment-read-sql.integration.test.js`
- `docs/SEG-03.md`

Frontend:

- `src/vistasAdmin/admin_pagos.jsx`
- `src/servicies/API_Pagos.js`
- `src/vistasAdmin/admin_pagos.source.test.js`

## Límites operativos

No hay cancelación automática, vencimiento de claims ni reintento de creación de preferencia después de fallo/timeout. Se prioriza impedir dobles obligaciones: esas órdenes requieren conciliación administrativa antes de otra operación. Tampoco se reparan automáticamente históricos, reembolsos parciales o contracargos; no hay una herramienta nueva de regularización en este alcance. La vista de diagnóstico permanece restringida al backend/operador de base.

No se probó Mercado Pago real ni un PostgreSQL de múltiples conexiones. El estado local se actualiza al recibir webhooks o consultas autorizadas al proveedor, no mediante un polling nuevo en servidor. La migración y el despliegue siguen pendientes fuera del entorno aislado.

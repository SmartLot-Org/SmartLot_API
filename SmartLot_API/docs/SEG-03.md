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

La sincronización autorizada es una acción explícita y se expone por POST, porque escribe en `pagos`: `POST /api/payments/:paymentId/verificar` (cuerpo opcional `{ externalReference, preferenceId }` para correlacionar un pago aún no vinculado) y `POST /api/payments/verificar` (cuerpo `{ externalReference, preferenceId? }`, devuelve el listado local resultante). Ambas exigen los roles 1, 2 o 4 y las mismas reglas de `paymentReadService`. Los GET (`/api/payments` y `/api/payments/:paymentId`) son lectura pura del estado local autorizado: no consultan a Mercado Pago ni escriben.

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

## Validación inicial (antes de corregir intentos múltiples)

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

## Corrección de intentos múltiples de un checkout

Los commits revisados de backend `9f7d16b` y frontend `7cff65c` mantenían dos defectos: el primer intento correlacionado fijaba `payment_id`, aunque estuviera rechazado, y los intentos siguientes podían modificar `settled` y los snapshots sin correlacionar con el pago aceptado. Además, las consultas por referencia dejaban de buscar al existir un ID local y la consulta de otro ID confundía la identidad de la orden con la del intento.

Se agregaron primero dos pruebas de regresión con la ruta HTTP del webhook y PGlite. Ambas fallaron con la implementación anterior:

| Secuencia | Antes | Después |
| --- | --- | --- |
| Rechazado `900` → aprobado `901`, ARS 120,15 | ID fijado en `900`; consumo pendiente | `accepted_payment_id=901`, `payment_id=901`, `settled=true`; consumo pagado |
| Aprobado `900` → rechazado `901` | `settled=false` pese a pago local aprobado | Aceptado `900`, liquidación y snapshots conservados |

### Persistencia y reconocimiento

La migración incremental `migrations/20261022130158_seg03_enterprise_payment_attempts.sql` agrega:

- `enterprise_payment_attempts`: identidad única, orden, último snapshot correlacionado, primera aprobación económicamente válida, primera reversión verificada y archivo de evidencia anterior.
- `enterprise_payment_orders.accepted_payment_id`: identidad definitiva e inmutable, asignada únicamente al aceptar un aprobado con referencia, preferencia/merchant order, identidad, importe, moneda y ausencia verificable de reembolsos correctos.
- `enterprise_payment_orders.reconciliation_issue`: incidencia explícita si se observa otro pago aprobado distinto, sin reemplazar el aceptado ni sumar cobertura.

`payment_id` mantiene compatibilidad con el esquema previo. En órdenes nuevas solo se asigna junto con `accepted_payment_id`; en registros anteriores puede contener un intento inicial no aceptado hasta la siguiente verificación válida. La migración permite reemplazar ese pin sin debilitar la inmutabilidad del pago que ya fue aceptado. No modifica importes, consumos ni preferencias, ni crea nuevas liquidaciones durante el backfill. Conserva pagos válidos y la evidencia económica anterior; los snapshots contradictorios se archivan en `legacy_evidence`. Una reversión de otra identidad o sin correlación demostrable deja de utilizarse como reversión del pago aceptado, conservando el original archivado.

Los candidatos se correlacionan específicamente con el checkout. No se modificó `providerPaymentMatchesLocal` ni se eliminaron sus controles de ID para consultas ordinarias y reembolsos. Los webhooks comprueban también que el ID consultado sea el devuelto por el proveedor.

La orden se bloquea en transacción. Los intentos correlacionados se guardan por ID con protección frente a referencias contradictorias. Un pendiente/rechazado no fija una asociación definitiva. Después de aceptar un pago, otro intento no reemplaza su estado, motivos ni snapshots financieros. Las reversiones se conservan por intento y solo reabren la cobertura cuando corresponden al aceptado. Antes de actualizarlo se bloquea y relee la fila local, incluyendo reembolsos manuales de SEG-01. Una respuesta antigua no elimina una reversión confirmada ni restaura la liquidación.

Dos aprobados distintos dejan `reconciliation_issue='multiple_approved_payments'` y evidencia por ID. Se conserva el pago aceptado y su cobertura, pero la cuenta señala regularización. No se emite otra preferencia, no se suman consumos pagados dos veces y no se realiza un reembolso automático del segundo cargo.

Consulta operativa de incidencias (restringida al operador de base):

```sql
SELECT reference, accepted_payment_id, reconciliation_issue, settled
FROM enterprise_payment_orders WHERE reconciliation_issue IS NOT NULL;
SELECT payment_id, reference, eligible_snapshot, reversal_snapshot, legacy_evidence
FROM enterprise_payment_attempts WHERE reference = 'referencia-a-conciliar';
```

### Consultas y reembolsos

La autorización SQL de SEG-02 se conserva y precede cualquier consulta al proveedor. El detalle por ID puede resolver un intento persistido de una orden autorizada o un candidato con contexto local autorizado. Solo en ese contexto empresarial se correlaciona el candidato con el checkout, sin exigir que sea el pago previamente aceptado.

La búsqueda por referencia ya no termina por tener `mp_payment_id`: consulta los distintos intentos, sigue la paginación informada y obtiene cada Payment individual para comprobar identidad y reembolsos. También vuelve a verificar el aceptado aunque no aparezca en los resultados de search. Dos aprobados no se tratan como una referencia local ambigua: quedan registrados como incidencia de esa orden.

La cuenta corriente requiere el ID aceptado junto con la preferencia y la cobertura verificada. `pagos` sigue teniendo una sola fila local por orden y conserva como `mp_payment_id` el aceptado. Así, el reembolso manual mantiene su correlación estricta y opera sobre ese pago. El contrato HTTP del frontend no cambia y no se modificaron archivos de frontend.

### Validación actual

Se ejecutaron las siete suites solicitadas y la nueva `test/enterprise-payment-attempts-migration.integration.test.js`: **131 pruebas aprobadas, 0 fallidas, 0 omitidas**. Se conservan las verificaciones de permisos de SEG-01/SEG-02. Las pruebas cubren además pendientes/rechazados antes o después del aprobado, mismo/distinto ID, evidencia no correlacionada, reversiones propias y ajenas, respuestas antiguas, doble aprobación, concurrencia, detalle y búsqueda HTTP, paginación, reembolso manual e idempotencia. La migración se ejecuta sobre datos anteriores reales en otra instancia PGlite y comprueba archivo, importes, asociaciones válidas y triggers.

Dos expectativas anteriores se adaptaron al comportamiento requerido: una reversión de orden debe ser del pago previamente aceptado; una merchant order no correlacionada no puede modificar una liquidación ya aceptada. Se mantienen pruebas para impedir que esas respuestas salden una orden nueva. La suite unitaria de cuentas corrientes ahora aísla su importación de DB para evitar conexiones externas; las consultas económicas y autorizaciones SQL se siguen ejecutando en PGlite en las suites de integración.

`npm run check:syntax`, `npm run check:routes` y `git diff --check`: aprobados. No se ejecutaron comprobaciones de frontend porque no hay cambios en ese repositorio. Mercado Pago está simulado; ninguna prueba efectúa cobros, reembolsos reales ni escrituras de producción.

### Archivos de esta corrección y despliegue

- `src/services/enterprisePaymentService.js`
- `src/services/paymentReadService.js`
- `src/controllers/paymentController.js`
- `src/repositories/cuentaCorrienteRepository.js`
- `migrations/20261022130158_seg03_enterprise_payment_attempts.sql` (nueva; no reemplaza la migración anterior)
- `test/enterprise-payment-sql.integration.test.js`
- `test/enterprise-payment-attempts-migration.integration.test.js` (nueva)
- `test/payment-read-sql.integration.test.js`
- `test/cuentas-corrientes.test.js`
- `docs/SEG-03.md`

Aplicar primero la migración original de órdenes si todavía no está instalada. Después, con los escritores de pagos detenidos, respaldo y base de staging seleccionada explícitamente:

```sh
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20261022130158_seg03_enterprise_payment_attempts.sql
```

Desplegar este backend antes de reanudar el procesamiento. No mezclar instancias con el sincronizador anterior: no entiende el pago aceptado ni la tabla de intentos. No requiere cambios ni despliegue de frontend. Las órdenes anteriores no liquidadas se recuperan mediante verificación autorizada por ID/referencia o un webhook; el backfill no declara pagado nada nuevo.

Persisten los límites anteriores de conciliación administrativa para históricos ambiguos, timeouts, reversiones y cargos duplicados. No hay distribución automática de devoluciones parciales ni compensación del segundo cargo. PGlite serializa transacciones en una conexión; no se ha realizado una prueba multiproceso con PostgreSQL ni se ha aplicado esta migración fuera del entorno aislado. SEG-04 queda fuera de alcance.

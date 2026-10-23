# SEG-03: observaciones concurrentes del mismo pago

## Causa y politica

La consulta a Mercado Pago termina antes de adquirir los bloqueos transaccionales.
Un bloqueo serializa escrituras, pero no ordena la informacion recibida. El calculo
de `eligible` por respuesta permitia que un pending anterior deshiciera un approved.

`mpService.getPayment` devuelve el objeto del SDK sin transformar sus fechas.
La [referencia oficial de Payments](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-pro-preferences/get-payment/get)
define `date_last_updated` como la fecha del ultimo evento del pago. Se compara
exclusivamente entre observaciones del mismo ID. No se usa `verified_at`, la fecha
del webhook, ni el orden de llegada como version financiera.

Se exige fecha ISO con zona explicita, calendario y hora validos y precision de
hasta milisegundos. Si se informan creacion/aprobacion, deben ser fechas validas
que no sucedan despues de la ultima actualizacion. Las fechas invalidas se tratan
como version desconocida.

| Evidencia previa | Observacion | Politica |
| --- | --- | --- |
| Cualquier estado | Version valida anterior | Conservar snapshots y efectos vigentes |
| Cualquier estado | Misma version, contradiccion financiera | Conservar evidencia y registrar incidencia |
| Pendiente/rechazado | Aprobacion con correlacion, economia y ausencia de reembolsos verificadas | Aceptar, salvo version anterior o igual contradictoria |
| Aprobado aceptado | Pendiente/rechazado, aunque declare version posterior | Conservar aprobacion y registrar contradiccion |
| Aprobado aceptado | Reembolso parcial/total o contracargo verificado | Revertir imputacion, salvo version anterior o igual contradictoria |
| Reversion confirmada | Aprobacion o disminucion del reembolso | Conservar reversion; nunca volver a saldar automaticamente |
| Reembolso parcial | Reembolso total o contracargo verificado | Permitir avance financiero, conservando evidencia original de reversion |
| Version desconocida | Contradiccion sin avance financiero verificable | Conservar evidencia y registrar incidencia |

Las incidencias usan `reconciliation_issue`; una incidencia previa se conserva.
La deteccion de multiples aprobados sigue usando `multiple_approved_payments`.
Una aprobacion de importe/moneda incorrectos no es evidencia financiera valida
que pueda bloquear una aprobacion posterior verificada de un intento no aceptado.

La decision se toma bajo el bloqueo de la orden y antes de sobrescribir el intento,
la orden o `pagos`. Se conserva la atomicidad existente. La proteccion de reversiones
manuales tambien se aplica antes de descartar una observacion duplicada o antigua.
La consulta por ID vuelve a leer el estado autorizado persistido despues de sincronizar;
los intentos no aceptados usan su snapshot conservado. El listado por referencia
continua verificando los detalles y leyendo el pago local aceptado.

No hay columnas ni migraciones nuevas: las fechas del proveedor ya estan en los
snapshots JSONB existentes. Las migraciones anteriores quedan intactas.

## Reproduccion y verificacion

Las dos pruebas `carrera mismo pago` retienen la primera consulta con promesas
controladas: pending/rejected de las 10:00, approved de las 10:01, luego liberacion
de la primera respuesta. Antes del cambio ambas fallaron con `settled=false`.
Con la correccion conservan `settled=true`, ID 900, estado approved, snapshots
vigentes y consumo pagado. No se usan sleeps para ordenar estas carreras.

La suite HTTP ejecuta SQL PostgreSQL mediante PGlite aislado y Mercado Pago simulado.
Incluye carreras desde consultas por ID/referencia, formatos de fecha, reversiones
versionadas, progresion de reembolso parcial a total y los dos casos de IDs distintos.

```sh
node --experimental-test-module-mocks --test test/enterprise-payment-sql.integration.test.js test/enterprise-payment-attempts-migration.integration.test.js test/mp-service.test.js test/mp-controller.test.js test/manual-refund-route.test.js test/payment-read-access.test.js test/payment-read-sql.integration.test.js test/cuentas-corrientes.test.js
npm run check:syntax
npm run check:routes
```

En PowerShell con scripts deshabilitados se usa `npm.cmd`.
Resultado: 152 pruebas aprobadas (131 anteriores y 21 nuevas), sin fallos ni
omisiones. `check:syntax` y `check:routes` aprobados; `git diff --check` limpio.
`test/mp-integration.test.js` requiere servicios y credenciales reales; no forma
parte de la ejecucion aislada con el proveedor simulado.

## Limites

Las contradicciones sin version comparable requieren regularizacion; no se inventa
una secuencia temporal. Las reversiones confirmadas no se restauran automaticamente.
Se conservan los snapshots financieros vigentes y la primera evidencia de aprobacion
y reversion. Esta correccion no reconstruye ordenes ya alteradas antes del despliegue.
No se ejecutan cambios contra produccion ni se implementa SEG-04.

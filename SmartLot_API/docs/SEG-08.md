# SEG-08: autenticidad del webhook de Mercado Pago

El endpoint público `POST /api/payments/webhook` requiere `MP_WEBHOOK_SECRET`
en todos los entornos. Un valor ausente, vacío o compuesto solo por espacios
produce `503` con el payload estándar de la API
(`{ "error": true, "message": "Webhook no disponible temporalmente.", "statusCode": 503 }`),
sin SQL ni consultas al proveedor. No bloquea el arranque ni el resto de la API.

La firma ausente, incorrecta o mal formada y los IDs contradictorios producen
`401 { "error": true, "message": "Firma de webhook inválida.", "statusCode": 401 }`.
Un sobre de notificación inválido (ID de evento o tipo ausentes/inválidos) produce
`400` con el mensaje `Payload de webhook inválido.`. Ninguno registra un evento válido
ni marca un evento existente como procesado/fallido.

> Cambio posterior (mejora de la API REST): antes la firma inválida respondía `400 { "error": "Invalid signature" }`
> y el sobre inválido `400 { "error": "Invalid webhook payload" }`. La firma inválida pasó a 401 (no se pudo
> autenticar al emisor) y las respuestas del webhook usan el formato de error común descrito en `docs/plans-franC/api-errores.md`.
> Los errores del proveedor de pagos al procesar un evento válido se informan como `502` con `code: "MP_UPSTREAM_ERROR"`.

## Contrato y corrección

Se consultó el [contrato oficial de Webhooks](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks).
SmartLot usa Checkout Pro y notificaciones de pagos. El manifiesto HMAC-SHA256
incluye `data.id` de query, `x-request-id` y `ts`. `body.id` identifica la
notificación y nunca sustituye al recurso. El recurso del body debe coincidir
con el de query; solo después se consulta ese mismo pago al proveedor.
Se conserva el control del ID devuelto por Mercado Pago y la consulta al
proveedor como fuente del estado financiero.

### Tópico y acción de pagos

El formato oficial admitido separa el tópico de la operación:

```json
{ "id": 12345, "type": "payment", "action": "payment.updated", "data": { "id": "100" } }
```

Con `type: "payment"`, las acciones `payment.created` y `payment.updated`
consultan el recurso autenticado y ejecutan las rutinas existentes de órdenes
empresariales, pagos y reservas. `payment.refunded` conserva la rutina de
reembolsos, con clasificación parcial/total obtenida del proveedor. Importes,
estados y metadata de la notificación no determinan el estado financiero.

Se conserva explícitamente el formato anterior con
`type: "payment.created"`, `"payment.updated"` o `"payment.refunded"`, sin
`action` o con una acción coincidente. Para el tópico `payment`, una acción
ausente, inválida o no admitida produce 400 antes del registro; una acción
contradictoria con un tipo anterior también produce 400. Otros tópicos
conservan el comportamiento previo y no se interpretan como pagos.

El éxito (`200`, evento sin error) se marca después de completar la
sincronización. Los errores de proveedor o persistencia se propagan con
respuesta no exitosa y se registran mediante el manejo existente; la entrega
puede reintentarse, aunque la fila del evento ya exista. No se agrega un filtro
que descarte el reintento por el campo `procesado`.

Se comprobó el SDK instalado: `mercadopago` 3.3.0 exporta
`WebhookSignatureValidator`. Se mantiene el verificador propio para conservar
su contrato booleano y aplicar comprobaciones estrictas sin coercionar arrays
u objetos. Rechaza componentes duplicados o mal formados de `x-signature`,
valida el digest hexadecimal antes de compararlo con `timingSafeEqual` y usa
el ID en minúsculas en el manifiesto.

Antes, la ausencia de secreto retornaba `true`, y el verificador podía firmar
query `100` mientras el controlador procesaba body `200`. Ahora se exige la
configuración y la coincidencia antes de cualquier efecto. El `catch` solo
puede marcar un evento después de que haya superado las validaciones y se
haya completado su registro. El procesamiento válido conserva su respuesta
`200 { "received": true }`, sus upserts y los controles de SEG-01 a SEG-03.

## Regresiones y validación

Se agregó primero `test/mp-webhook-auth.test.js`, con router y verificador
reales, SDK simulado y SQL controlado. Antes de corregir, fallaron seis de
ocho casos: sin secreto se obtuvo 200 en vez de 503; query 100/body 200 obtuvo
200 en vez de 400; una firma truncada produjo 500. También se reproducían
rechazos inseguros de campos y el uso de `body.id` como recurso.
Después pasan los ocho casos. Comprueban ausencia de SQL y llamadas al
proveedor en rechazos, incluido un evento existente con el ID del body;
secretos ausentes/vacíos/espacios en producción/desarrollo/test con sandbox
activado y desactivado; tipos inválidos; procesamiento legítimo repetido;
y rechazo 409 de identidad contradictoria del proveedor.

Se reemplazó la expectativa insegura en `test/mp-service.test.js`. Las suites
anteriores que simulan el servicio reciben un secreto efímero para respetar
el nuevo requisito de configuración; las regresiones de autenticidad no
simulan `verifySignature()`.

Comando de suites aisladas (162 pruebas aprobadas tras completar la revisión funcional):

```sh
node --experimental-test-module-mocks --test test/mp-service.test.js test/mp-controller.test.js test/mp-webhook-auth.test.js test/enterprise-payment-sql.integration.test.js test/enterprise-payment-attempts-migration.integration.test.js test/manual-refund-route.test.js test/payment-read-access.test.js test/payment-read-sql.integration.test.js
```

### Regresión del formato oficial

El controlador confundía `type` con `action`. Se agregaron primero dos
regresiones firmadas de `payment.created` y `payment.updated` usando router y
verificador reales, simulando únicamente SDK y SQL. Ambas fallaron antes del
arreglo: HTTP 200 pero lista de consultas al proveedor vacía en lugar de
`['100']`. Al adaptar también los fixtures positivos de autenticidad al
formato oficial, la primera corrida tuvo cuatro fallos de diez casos.

Después, `mp-webhook-auth.test.js` pasa sus 15 casos: comprueba consulta exacta,
sincronización y persistencia anteriores al marcado de éxito, importe y estado
del proveedor (100 y approved) pese a valores contradictorios en el body,
repetición sin duplicados, compatibilidad anterior, reembolsos y errores de
proveedor/persistencia seguidos de reintento exitoso. Conserva las regresiones
de secreto, firmas, tipos e identidad contradictoria sin efectos.

La suite empresarial usa PGlite y las rutinas reales de sincronización; su
fixture de servicio MP sigue simulado, como antes. Para ambas acciones
oficiales se verifican dos entregas y, antes de cualquier lectura que pudiera
sincronizar por otro camino, una orden liquidada con pago aceptado 900, un
único pago approved de 120.15, un único intento y solo el consumo local 1
asociado. El evento queda procesado sin error. Las pruebas existentes de
concurrencia, eventos fuera de orden y reembolsos también pasan.

Controles adicionales aprobados: `npm run check:syntax`,
`npm run check:routes` y `git diff --check`. Durante el desarrollo se corrigió
una aserción SQL nueva que consultaba una columna `status` inexistente: ahora
verifica `settled` y `accepted_payment_id`, los campos reales de la orden.

No ejecutar `npm run test:mp` ni `test/mp-integration.test.js` para esta
verificación: la suite de integración existente importa la aplicación con
`.env`, utiliza servicios externos y puede crear pagos reales. Se omite
deliberadamente. Las suites anteriores usan mocks y PGlite local, sin pagos,
credenciales ni servicios reales.

## Configuración y despliegue

1. En Mercado Pago, abrir **Tus integraciones → aplicación → Webhooks →
   Configurar notificaciones**. Configurar la URL HTTPS pública del backend,
   `/api/payments/webhook`, y los eventos de pagos de la integración.
2. Obtener la clave de firma generada por Webhooks y guardarla como
   `MP_WEBHOOK_SECRET` en el gestor de secretos o entorno del backend.
   Mantenerla exclusivamente en el servidor, fuera del repositorio, logs y
   frontend. Es distinta de `MP_ACCESS_TOKEN`; no sustituir una por la otra.
3. Configurar también las instancias de desarrollo/sandbox con su clave
   correspondiente. No hay excepción para recibir notificaciones sin firma.
4. Desplegar el backend y reiniciar todas las instancias para que reciban
   la variable. Comprobar su presencia sin imprimir su valor. No requiere
   migraciones ni despliegue del frontend.
5. En el entorno de prueba de Mercado Pago, verificar una notificación
   firmada y coherente. Debe devolver 200; sin configuración, 503; con firma
   inválida o IDs contradictorios, 401 sin efectos. No se realizaron estas
   comprobaciones externas durante la corrección local.

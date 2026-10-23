# SEG-06: codigos de recuperacion

Base revisada: `799b1aeef6e46ed7dea270f4a54382b35ec289f2`. Backend y frontend
estaban limpios al comenzar. Se conserva el trabajo de SEG-01 a SEG-05.

## Causa y reproducciones antes/despues

Se generaban seis digitos con Math.random. No existia presupuesto persistido de
errores ni limites por cuenta para emitir. Leer/comparar/marcar el codigo y crear
una sesion o cambiar password usaban queries independientes. Algunos helpers
ocultaban fallos SQL. Dos requests podian validar el mismo codigo disponible.

Primero se agregaron dos pruebas HTTP con router real, JWT/bcrypt y PostgreSQL
embebido PGlite, sin correo real. Ambas fallaron antes de tocar la implementacion:

| Reproduccion | Antes | Despues |
| --- | --- | --- |
| Seis errores alternando login/reset y luego el correcto | Login 200 | Login 401, codigo agotado; usuario/sesiones intactos |
| Dos logins con ambas lecturas retenidas por promesas | 200 y 200 | 200 y 401; una sola sesion nueva |

El mismo test de carrera conserva la barrera de las dos lecturas anteriores y
ahora tambien reconoce el bloqueo transaccional: retiene al primero tras leer el
codigo y espera que el segundo solicite conexion antes de liberar. No usa sleeps.

## Politica y atomicidad

Valores centralizados en `src/config/recoveryPolicy.js`:

- Cinco errores por codigo, compartidos entre login y restablecimiento. El quinto
  marca usado=true. No se alteran usuario, password, auditoria, version ni sesiones.
- Diez minutos de vigencia, calculados y comprobados con reloj SQL. Se vuelve a
  comprobar disponibilidad/vigencia al consumir, despues de bcrypt.
- Codigo de seis digitos generado con crypto.randomInt(100000,1000000), almacenado
  exclusivamente con bcrypt (BCRYPT_ROUNDS existente). Nunca se registra el codigo.
- Espera minima de 60 segundos entre emisiones y maximo tres emisiones por cuenta
  en una ventana movil de quince minutos. Se cuenta el historial, incluso usado.
- Solo emitir realmente otro codigo invalida todos los anteriores. Una solicitud
  limitada no invalida el codigo que el usuario ya recibio.
- Un unico consumo exitoso. Emision, login y reset usan el mismo orden de bloqueos:
  SELECT del usuario FOR UPDATE OF u, luego codigo FOR UPDATE cuando corresponde.
  El bloqueo del usuario serializa tambien emision/consumo entre procesos. No hay
  contadores en memoria. El indice parcial impide mas de una fila disponible.
- Los intentos fallidos se escriben y hacen COMMIT; solo despues se lanza el error
  esperado. No se pierden por el rollback del error de credenciales. El incremento
  y consumo tienen condiciones de disponibilidad, presupuesto y expiracion.
- Login consume y crea la sesion con el mismo cliente SQL dentro de BEGIN/COMMIT.
  El controller solo recibe datos para emitir cookies despues del COMMIT. Conserva
  claims, rol y garages del contrato anterior y paths de cookies.
- Reset consume, cambia password/auditoria, incrementa token_version y elimina
  todas las sesiones del usuario con ese mismo cliente/transaccion. Un fallo SQL
  revierte todo y se propaga como error interno, tambien al emitir o leer.

Los antiguos helpers de reset en UsuarioRepository no tenian otros consumidores;
se sustituyeron por RecoveryRepository con cliente obligatorio. Las firmas publicas
de UsuarioService se conservan y delegan en RecoveryService. No se modifican login
normal, refresh, logout, autorizacion de perfiles, pagos ni reservas.

## Contrato publico y correo

`POST /api/usuario/recuperar-clave` siempre devuelve 200 y el mismo mensaje generico
con retry_after=60 y Retry-After:60 para cuentas inexistentes, invalidas, inactivas,
borradas, limitadas o con emision. No revela existencia ni contadores. El aviso
publico no informa cuanto falta para el limite privado de quince minutos: puede
no producirse un envio aunque termine la espera visual de sesenta segundos.

Se conserva authRateLimiter por IP en los tres endpoints; su 429 incluye un
Retry-After numerico positivo, comprobado por HTTP. Codigos incorrectos, vencidos,
agotados, usados o de otra cuenta devuelven el mismo mensaje generico; se conservan
los status del contrato (401 en login y 400 en reset). Las validaciones estructurales
de email/codigo/password del controller conservan sus 400.

El correo se intenta y espera despues del COMMIT, fuera de la transaccion SQL.
Si falla su transporte, se conserva la respuesta generica (o el reset ya confirmado)
y se registra solo un mensaje fijo, sin objeto del error ni codigo. No hay outbox
ni garantia de entrega; una emision persistida cuenta aunque el correo falle y se
puede pedir otro codigo respetando los limites. No hay respuestas de exito ante un
fallo SQL del ciclo de recuperacion.

Frontend existente: `C:/Users/Augusto/Downloads/SmartLot`. ForgotPassword conserva
ambas opciones, muestra mensajes del servidor y agrega solicitar un nuevo codigo.
La espera de reenvio es independiente del uso del codigo. Un 429 utiliza Retry-After
(segundos o fecha HTTP); no se cambia cliente HTTP, navegacion, auth ni estilos.

## Migracion y despliegue

`migrations/20261023020040_seg06_recovery_codes.sql` fue generada con
`supabase migration new seg06_recovery_codes` (CLI 2.121.0) y ubicada en el directorio
de migraciones existente. No se aplico a una base remota.

Agrega failed_attempts smallint NOT NULL DEFAULT 0 y CHECK entre cero y cinco,
indice unico parcial por usuario WHERE usado=false e indice de historial por
usuario/creado_en. No agrega tablas ni cambia permisos/RLS existentes. Invalida
todos los codigos legacy disponibles porque no es posible reconstruir su presupuesto
de errores. Conserva filas, hashes y fechas; esos registros siguen contando para
el limite de emision reciente. El usuario debe solicitar otro codigo.

Pasos de despliegue:

1. Pausar los tres endpoints de recuperacion y drenar requests en todas las
   instancias; el resto de autenticacion no requiere este cambio.
2. Aplicar una sola vez la migracion incremental en orden, usando el mecanismo de
   despliegue existente. Su BEGIN/COMMIT agrupa DDL, invalidacion e indices.
3. Desplegar todas las instancias del backend nuevo antes de reabrir recuperacion:
   una instancia vieja podria seguir emitiendo sin los nuevos limites.
4. Desplegar frontend y reabrir los endpoints. Verificar con cuenta controlada y
   transporte de pruebas segun el entorno; no usar codigos historicos.

No se debe volver a un backend antiguo dejando recuperacion habilitada. Esta tarea
no ejecuta el despliegue ni modifica migraciones anteriores. Si se cambia en el
futuro el maximo de intentos, debe coordinarse la configuracion con el CHECK SQL.

## Pruebas

29 nuevas pruebas HTTP/SQL en `test/recovery-sql.integration.test.js`: presupuesto
compartido y persistido entre instancias, errores concurrentes, login/login y
login/reset simultaneos en ambos ordenes, vigencia al consumir, otra cuenta,
inactivo/borrado, emision concurrente y limites de ventana, historial, bcrypt,
rollback por triggers SQL al emitir/crear sesion/cambiar password/eliminar sesiones,
error SQL en lecturas, respuesta retenida hasta COMMIT, login normal/nueva password,
login de garagista con garages y refresh, privacidad y 429 del limitador por IP.
La migracion se ejecuta en dos bases aisladas, una con filas legacy duplicadas;
se prueban realmente sus restricciones. El fixture previo de tenant-writes ahora
aplica la migracion antes de su regresion de recuperacion.

Comando completo (desde SmartLot_API/):

```sh
node --experimental-test-module-mocks --test test/recovery-sql.integration.test.js test/logout-sql.integration.test.js test/garage-occupancy-sql.integration.test.js test/garage-propio.test.js test/garage-responsables.test.js test/garage-sin-sede.test.js test/garage-and-trato.test.js test/tenant-writes-sql.integration.test.js test/usuario-repository.test.js test/reserva-repository.test.js test/reserva-qr.test.js test/reservation-policy.test.js test/reservation-limit.integration.test.js test/solicitud-registro.test.js test/garagista-regla.test.js test/enterprise-payment-sql.integration.test.js test/enterprise-payment-attempts-migration.integration.test.js test/mp-service.test.js test/mp-controller.test.js test/manual-refund-route.test.js test/payment-read-access.test.js test/payment-read-sql.integration.test.js test/cuentas-corrientes.test.js
npm run check:syntax
npm run check:routes
git diff --check
```

Resultado: **504 aprobadas, 0 fallos, 1 omitida** (475 anteriores y 29 nuevas).
Sintaxis (97 archivos), rutas y diff pasan. En PowerShell se uso npm.cmd.

Frontend: **121 pruebas aprobadas**, lint dirigido de ForgotPassword/recoveryRetry
y su prueba aprobado, build aprobada (advertencia de chunks grandes preexistente).
El lint global se ejecuto y falla con **108 errores y 4 advertencias en archivos
ajenos**, incluida deuda de scripts .agents y componentes de pagos. No se cuenta
como aprobado ni se corrige fuera de alcance.

## Omisiones y limites

- Sigue omitida reservation-limit.integration.test.js por falta de
  TEST_RESERVATION_DATABASE_URL/PostgreSQL local. No se cuenta como aprobada.
- PGlite tiene una conexion: ejecuta SQL real, bloqueos, constraints y rollback,
  con promesas controladas y serializacion del cliente de pruebas. No prueba
  contencion entre conexiones independientes de un servidor PostgreSQL ni
  procesos reales; la exclusion en produccion depende de los bloqueos SQL.
- No se ejecuta Mercado Pago real ni se usan produccion, credenciales reales o
  envio de correos reales. Proveedores/correo simulados.
- No se realizo prueba visual interactiva de navegador; se verifica frontend
  mediante sus suites, helper de Retry-After, lint dirigido y build.
- No se uniformiza latencia entre cuentas; la respuesta publica es generica.
  La entrega de correo no es atomica con SQL y puede fallar tras persistir codigo.

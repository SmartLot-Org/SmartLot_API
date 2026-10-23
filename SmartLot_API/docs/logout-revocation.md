# Logout: credencial verificada y revocacion atomica

Base revisada: `c26b0d9bc0e80b64535908940ab4e87d39991f8e`.
El arbol estaba limpio al comenzar. Esta correccion se limita a
`POST /api/usuario/logout` y la revocacion que ejecuta.

## Causa y reproduccion

El controller usaba `jwt.decode` sobre `access_token`, tomaba el ID sin verificar
firma/vencimiento y lanzaba la revocacion sin esperar, ocultando errores. El servicio
incrementaba la version y eliminaba sesiones en operaciones separadas.

Primero se agrego y ejecuto una reproduccion HTTP con router, JWT real firmado con
una clave incorrecta y SQL real sobre PGlite aislado. Usuario 9: version 7 y una
sesion de refresco; usuario 8 de control con su propia sesion.

| Resultado | Antes | Despues |
| --- | --- | --- |
| HTTP | 200 | 200, cookies eliminadas |
| Version del usuario 9 | 8 | 7 |
| Sesiones del usuario 9 | 0 | 1 |
| Usuario/sesiones del usuario 8 | Sin cambios | Sin cambios |

La prueba fallo antes del cambio y pasa despues. Los snapshots de pruebas usan
huellas SHA-256 de los tokens para evitar imprimir credenciales en los diffs.

## Comportamiento final

- La unica fuente es la cookie `access_token`. Body, query, Authorization y
  `refresh_session_id` no proporcionan un ID alternativo para esta operacion.
- `verifyLogoutCredential` usa `jwt.verify` con `JWT_SECRET` y `algorithms: ['HS256']`,
  coherente con el algoritmo predeterminado de la emision actual. Verifica firma,
  expiracion y not-before. Exige objeto con ID integer positivo, version integer
  no negativa, `iat`/`exp` enteros y expiracion posterior a la emision. ID/version
  respetan el rango integer actual de PostgreSQL y no aceptan coerciones de strings
  ni booleanos.
- Los access actuales no llevan `type`; se acepta ausencia o `type='access'`.
  Refresh y otros tipos se rechazan, incluso si las dos claves fueran iguales.
- Sin token, con firma/formato/algoritmo invalido, vencido o sin los claims exigidos:
  200 y limpieza local, sin abrir cliente SQL. Un access sin version no habilita
  una revocacion inferida a partir del estado actual del usuario.
- Con credencial criptograficamente valida, un UPDATE condicional comprueba usuario
  persistido activo/no borrado y `token_version` exacta. Solo si modifica esa fila
  incrementa la version y elimina **todas** las sesiones de ese mismo ID. Usa el
  mismo cliente SQL dentro de BEGIN/COMMIT. Un usuario inexistente, inactivo, borrado
  o una version distinta producen limpieza local sin cambios de revocacion.
- La condicion de version y el bloqueo del UPDATE impiden que dos logout de la
  misma version revoquen sucesivamente sesiones nuevas. Un access antiguo sigue
  siendo inocuo despues de un nuevo login.
- La respuesta espera la revocacion y el COMMIT. Un fallo SQL revierte los cambios
  y se propaga como 500; no se convierte en credencial invalida ni exito. La falta
  de clave configurada tambien es un error interno. No hay tareas en segundo plano
  ni `.catch(() => {})` en este camino.
- El controller limpia ambas cookies en `finally`, incluso ante errores. Conserva
  HttpOnly, SameSite=Lax, Secure en produccion y los paths originales: `/` para
  access y `/api/usuario/refresh` para la sesion. No depende de recibir la cookie
  de refresco en `/logout` ni amplia su path.

Se revisaron los consumidores de revocacion: el antiguo unico llamado HTTP a
`revocarRefreshTokensAsync(id)` era logout. Se agregaron `logoutAsync(token)` y
`revokeLogoutSessionsAsync(id, version, client)` para este flujo; las firmas y
operaciones internas existentes de revocacion, estado, contraseña, login y refresh
se conservan. No se refactoriza el middleware de autenticacion ni el recupero.

El frontend ya llama POST sin identidad adicional desde
[src/api/token.js](https://github.com/SmartLot-Org/SmartLot/blob/main/src/api/token.js).
El endpoint y el JSON de exito siguen iguales. No hay cambios de frontend ni
migraciones.

## Archivos

- `src/controllers/usuarioController.js`: espera logout y limpia cookies en finally.
- `src/helpers/logoutCredential.js`: verificacion criptografica y de claims.
- `src/services/usuarioService.js`: transaccion especifica para logout.
- `src/repositories/usuarioRepository.js`: incremento condicionado por version y
  eliminacion de sesiones, sin ocultar errores.
- `test/logout-sql.integration.test.js`: 42 pruebas nuevas con JWT y SQL reales.
- Este documento.

## Verificacion

Se uso PostgreSQL embebido PGlite, claves aleatorias exclusivas del proceso,
router Express y cookie-parser reales. Solo el transporte de base se sustituye;
no se simula la verificacion de firma. Correo deshabilitado en el fixture.

Las pruebas cubren firmas y payloads manipulados, none/HS384, refresh con claves
iguales, vencimiento/nbf, claims invalidos, usuario/version persistidos, objetivos
ajenos en body/query, login/refresh legitimos y cookies de navegador con sus paths.
Tambien verifican version cero, repeticion, nuevo login y reutilizacion del token.

Promesas controladas retienen el DELETE y el COMMIT y comprueban que la respuesta
no termina mientras estan pendientes. Otro escenario retiene un segundo logout
con la misma version, confirma el primero, crea una sesion mediante login y libera
el segundo: la nueva sesion permanece. No se usan sleeps. Un trigger SQL falla
despues del incremento y modifica otro usuario antes de lanzar el error: el rollback
conserva usuarios y sesiones completos y la respuesta 500 limpia las cookies.

Desde `SmartLot_API/`:

```sh
node --experimental-test-module-mocks --test test/logout-sql.integration.test.js
```

Se ejecuto ademas la suite completa de
[`seg04-garage-occupancy.md`](seg04-garage-occupancy.md), agregando el nuevo archivo
al mismo comando de Node. Resultado combinado: **475 aprobadas, 0 fallos, 1 omitida**
(42 nuevas y 433 regresiones existentes, incluidas SEG-03 y SEG-04).

```sh
npm run check:syntax
npm run check:routes
git diff --check
```

En PowerShell se uso `npm.cmd`. Los tres checks pasan. No se usaron produccion,
credenciales reales ni envios reales de correo/pagos. La implementacion no registra
tokens ni secretos.

## Omisiones y limites

La suite `reservation-limit.integration.test.js` sigue omitida por no estar
configurado `TEST_RESERVATION_DATABASE_URL` para PostgreSQL local; no se cuenta
como aprobada. No se ejecuta la integracion con Mercado Pago real, que queda fuera
de la suite aislada documentada. El frontend no cambia y no requiere nuevos checks.

PGlite utiliza una sola conexion: se verifica SQL, rollback y orden determinista
de requests/transacciones, pero no contencion entre conexiones independientes de
un servidor PostgreSQL. No se amplian otros flujos de autenticacion ni se reparan
datos historicos. Tokens sin version/claims validos solo limpian cookies; nunca
se usa una version obtenida de la base para autorizar retroactivamente un token.

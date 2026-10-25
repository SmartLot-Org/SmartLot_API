# Política de errores y contrato de escritura de la API

> Última actualización: 2026-10-25 (Fases 1 a 6 del plan "API REST"). Ver el estado del trabajo en el repo del frontend: `docs/plans-franC/estado-api-rest.md`.

Este documento fija **una sola forma** de reportar errores y de definir escrituras en la API. Es la regla que siguen los controllers, services y repositories nuevos y la referencia para revisar los existentes. La razón de fondo (devolución del docente, punto 4): *"no encontré" es un resultado; "falló la consulta" es una excepción*. Si se representan igual, la API le dice al usuario algo falso.

## 1. Política por capa

| Capa | Qué hace con los errores |
|---|---|
| **Repository** | Devuelve `null` / `[]` / `false` **solo** cuando no hay filas. Un fallo de la base **se propaga** (no hay `try/catch` que lo traduzca a `null`). |
| **Service** | Aplica reglas de negocio y lanza errores de dominio con `statusCode` (`throwError` / `httpError`). |
| **Controller** | Valida la entrada (400) y traduce `null` → 404 en GET/PUT/DELETE por id. No agrega `try/catch + next`: Express 5 propaga los rechazos async. |
| **`errorHandler`** | Es el único lugar que arma la respuesta de error y que traduce excepciones del driver. |

Una lista vacía es `200 []`, nunca un error. Un alta que falla en la base es una excepción (409/400/500 según el caso), nunca un `null` que el controller convierta en "Error interno" a ciegas.

## 2. Formato de error

```json
{ "error": true, "message": "Texto en español", "statusCode": 409, "code": "DB_UNIQUE_VIOLATION" }
```

- `message`: en español. En un 500 es siempre `"Error interno del servidor"` (el detalle va al log, no al cliente).
- `code`: opcional; identifica la causa para el frontend (`payment_not_found`, `MP_UPSTREAM_ERROR`, `RESERVATION_LIMIT_REACHED`, `DB_*`).
- Rutas inexistentes: `404 { error: true, message: "Ruta no encontrada.", statusCode: 404 }` (antes, HTML de Express).
- Origen CORS no permitido: `403 "Origen no permitido."` (antes un 500).

### Helpers (única forma de lanzar un error con status)

`src/helpers/httpError.js`: `httpError(message, statusCode = 500, extra)` crea el error; `throwError(...)` lo lanza. `extra` es un string (se guarda como `code`) o un objeto (`{ code, details, paymentId }`). **Sin `statusCode` explícito el error es un 500**: un 400 por omisión escondería fallos propios detrás de un error del cliente. Las constantes están en `src/helpers/httpStatus.js`.

Reemplazó 25+ copias locales (`throwError`, `fail`, `writeError`, `httpError` con firmas y defaults distintos: 400 en un archivo, 409 en otro, sin default en otros).

## 3. Errores de Postgres que el `errorHandler` traduce

Solo cuando el error llega **sin** `statusCode` (una excepción cruda del driver). Si el service ya decidió el status, no se reinterpreta.

| SQLSTATE | Status | `code` | Mensaje |
|---|---|---|---|
| `23505` unique | 409 | `DB_UNIQUE_VIOLATION` | Ya existe un registro con esos datos. |
| `23503` foreign key | 409 | `DB_FOREIGN_KEY_VIOLATION` | La operación referencia o depende de otros registros. |
| `23502` not null | 400 | `DB_NOT_NULL_VIOLATION` | Falta un dato obligatorio. |
| `23514` check | 400 | `DB_CHECK_VIOLATION` | Los datos no cumplen las reglas del sistema. |
| `22P02` formato | 400 | `DB_INVALID_FORMAT` | Alguno de los datos tiene un formato inválido. |
| `22001` demasiado largo | 400 | `DB_VALUE_TOO_LONG` | Alguno de los datos supera el largo permitido. |
| `22003` fuera de rango | 400 | `DB_VALUE_OUT_OF_RANGE` | Alguno de los datos está fuera del rango permitido. |

Los mensajes son genéricos a propósito: el detalle del driver expone tablas y columnas. Cualquier otro código sigue siendo 500.

## 4. La sesión y los errores

**Un 5xx nunca toca la sesión.** Antes, `errorHandler` borraba las cookies en todo 500: un `PATCH` a una notificación inexistente (que salía como 500) desloguea al usuario. Ahora la sesión la invalidan únicamente:

- `authMiddleware` → **401** con `Set-Cookie` que limpia, solo si el JWT es inválido/expirado.
- `POST /api/usuario/logout`.
- `POST /api/usuario/refresh` → solo ante un rechazo de dominio (4xx). Una cookie de sesión mal formada (no UUID) es 401 sin consultar la base; una base caída es 500 y la sesión queda viva.

Si la base cae durante `authMiddleware` (consulta del usuario), responde **500**, no 401: el cliente interpreta 401 como "sesión vencida" y dispara el refresh/logout. El frontend no cambia: su cola de refresh solo reacciona al 401.

## 5. Validación de la entrada

- **`:id` de ruta**: `router.param('id', idParam())` (`src/helpers/validatorHelper.js`). `7abc`, `0`, `-1`, `1.5`, `1e3` y enteros no seguros responden **400** *antes* del handler y sin consultar la base; el handler recibe un `Number`. Otros parámetros: `idParam('ID de garage')` para `:id_garage`, etc. No aplica a `:paymentId` (id de Mercado Pago, validación propia) ni a `:codigo`/`:dia` (texto).
- **Cuerpo ausente**: Express 5 deja `req.body` en `undefined` sin JSON. `app.js` lo normaliza a `{}`: sin esto, un pedido sin cuerpo terminaba en `TypeError` → 500.
- Los ids del cuerpo se validan en el controller con `isValidId` / `isValidString`.

## 6. Semántica de escritura: PUT vs PATCH

- **PUT = reemplazo completo.** Se exigen los campos obligatorios del recurso; faltar uno es **400** (nunca un `UPDATE` que pise columnas con `NULL`).
- **PATCH = actualización parcial.** Solo cambia los campos presentes; al menos uno es obligatorio.

| Endpoint | Regla del PUT | PATCH |
|---|---|---|
| `PUT /api/marca/:id` | exige `nombre` | — |
| `PUT /api/modelo/:id` | exige `nombre` e `id_marca` | — |
| `PUT /api/rol/:id` | exige `tipo_rol` | — |
| `PUT /api/empresa/:id` | exige `nombre` y `descripcion` explícita (texto o `null`) | — |
| `PUT /api/sede/:id` | exige `nombre` y `ubicacion` explícita (texto o `null`). `id_empresa`, `descripcion` y coordenadas no enviados **se conservan** (tienen efecto de tenant/mapa; ver SEG-04) | `PATCH /api/sede/:id` (nuevo) |

**Deuda conocida (PUT parcial heredado, sin PATCH todavía):** `garage`, `vehiculo`, `usuario`, `reserva`, `conflicto`, `trato-empresa-garage`. Se aceptan campos parciales con `PUT`; migrarlos a `PATCH` rompe al frontend y no estaba en el alcance.

## 7. Pagos

- `GET /api/payments` y `GET /api/payments/:paymentId` son **lectura pura** del estado local autorizado: no consultan a Mercado Pago ni escriben `pagos`.
- La verificación contra Mercado Pago (que sí escribe) es una **acción POST**: `POST /api/payments/:paymentId/verificar` (body opcional `{ externalReference, preferenceId }`) y `POST /api/payments/verificar` (body `{ externalReference, preferenceId? }`, devuelve el listado local resultante). Mismos roles (1, 2, 4) y mismas reglas de autorización que la lectura.
- Webhook (`POST /api/payments/webhook`): firma inválida → **401** `"Firma de webhook inválida."` (antes 400 `{ error: "Invalid signature" }`); sobre inválido → 400 `"Payload de webhook inválido."`; sin secreto → 503. Todos con el formato estándar. Ver `SEG-08.md`.
- Un fallo del proveedor (cualquier error del SDK de Mercado Pago, incluidos 401/403/429/5xx) se informa como **502** con `code: "MP_UPSTREAM_ERROR"` y mensaje genérico. **El status del proveedor no se reenvía**: un 401 de Mercado Pago se leía en el frontend como sesión vencida. La excepción es "pago no encontrado" (404 propio, `payment_not_found`).

## 8. Rutas retiradas y convención de nombres

| Retirado | Reemplazo | Motivo |
|---|---|---|
| `GET /api/garage/:id/cercanos` | `GET /api/garage/cercanos?sede_id=` | Duplicado, `:id` era en realidad una sede, y la consulta de la sede no aplicaba el filtro de tenant. |
| `DELETE /api/trato-empresa-garage/:id` | `PATCH /:id/cancelar` | Alias histórico. |
| `PATCH /api/usuario/:id/contraseña` y `/contrase%C3%B1a` | `PATCH /api/usuario/:id/contrasenia` | Segmento con `ñ` (viaja percent-encoded). |
| `POST /api/trato-empresa-garage` para admin | `POST /api/solicitud-empresa-garage` | Un endpoint devolvía dos entidades (trato o solicitud según el rol). Ahora el alta directa es solo del superadmin. |

**Convención para rutas nuevas:** kebab-case, sustantivos en plural, en castellano, solo ASCII. **No se renombran rutas existentes** (rompe al frontend); las excepciones heredadas (`/ocupacion_reserva/:id`, `/control-acceso`, `/no-leidas/count`, etc.) quedan como están.

Otras limpiezas de contrato: `authMiddleware` ya no se repite en cada ruta de `reserva` y `notificacion` (lo aplica `app.js`); `GET /api/usuario*` deja de enviar `limite_reservas_activas` duplicado (queda `limiteReservasActivas`).

## 9. `catch` que se conservan (y por qué)

Un `catch` en un repository o service es válido solo si **traduce un caso conocido y relanza el resto**:

| Dónde | Qué hace |
|---|---|
| `ConflictoRepository` (3 funciones) | Fallback si faltan las columnas `DeleteBy`/`DeleteAt` (`42703`); cualquier otro error se relanza. |
| `usuarioRepository.createAsync` / `createWithClientAsync` | `23505` → 409 "Ya existe un usuario con ese email."; el resto se relanza. |
| `solicitudRegistroRepository` | `23505` de `uq_solicitudes_registro_email_pendiente` → `null` (otra petición ganó el índice; SEG-10B). |
| `solicitudEmpresaGarageRepository`, `tratoEmpresaGarageRepository`, `garageService` | `23505` → 409 con mensaje específico. |
| Transacciones (`BEGIN`/`COMMIT`) | `ROLLBACK` y relanzar. |
| Login (`SEG-10A`) y alta pública de solicitud (`SEG-10B`) | Un middleware de error por ruta convierte cualquier error crudo de la base en un 500 genérico, para que un `23505` no se vuelva un 409 que revele si un correo ya está registrado. |

## 10. Estado de los hallazgos del informe (sección 2.3)

"Resuelto en" indica la fase del plan. **Nada está commiteado todavía**: la columna se completa con el hash cuando se commitee (el trabajo vive en la rama `api-rest-improvement`).

| Hallazgo | Sev. | Estado | Resuelto en | Evidencia (tests) |
|---|---|---|---|---|
| Repos que se tragan errores y devuelven `null` | ALTO | Resuelto: 75 `catch` removidos en 11 repos + 4 funciones más | Fase 1 | `test/api-errores.test.js` |
| PUT validado como parcial que pisa columnas | ALTO | Resuelto en marca, modelo, rol, empresa y sede (con `PATCH`) | Fase 2 | `test/api-validacion.test.js` |
| 404 que sale como 500 y desloguea | ALTO | Resuelto (notificaciones 404; 5xx no borra cookies) | Fase 1 | `test/api-errores.test.js` |
| `authMiddleware` responde 401 si cae la DB | MEDIO | Resuelto | Fase 1 | `test/api-errores.test.js` |
| `paymentController` con otro dialecto | MEDIO | Resuelto | Fase 4 | `test/mp-controller.test.js`, `test/mp-webhook-auth.test.js` |
| GET con efectos secundarios en pagos | MEDIO | Resuelto (POST `…/verificar`) | Fase 4 | `test/payment-read-access.test.js`, `test/payment-read-sql.integration.test.js` |
| Validación de `:id` inconsistente | MEDIO | Resuelto en todos los routers | Fase 3 | `test/api-validacion.test.js` |
| Validación duplicada en PUT reserva | MEDIO | Resuelto | Fase 3 | `test/api-validacion.test.js` |
| Un endpoint que devuelve dos entidades | MEDIO | Resuelto | Fase 5 | `test/api-contrato.test.js` |
| Status puntuales, `authMiddleware` doble, endpoints huérfanos, errores de MP reenviados | BAJO | Resuelto | Fases 4-5 | `test/api-contrato.test.js`, `test/mp-service.test.js` |
| Naming, contrato de usuario | BAJO | Resuelto (convención documentada; contrato limpio) | Fase 5 | `test/api-contrato.test.js` |
| Contrato publicado (`docs/plans-franC/api.md`, Postman) | SUGERENCIA | Resuelto: inventario generado del router real (137 endpoints) + colección Postman generada con casos de error | Fase 6 | `test/api-inventario.test.js` |

## 11. Cómo verificar a mano

Con el backend local (`npm run app`) y una sesión superadmin:

```bash
curl -X PUT  /api/marca/5 -H 'Content-Type: application/json' -d '{}'      # 400 (antes 404)
curl         /api/marca/7abc                                                # 400 (antes pedía la marca 7)
curl -X PATCH /api/notificacion/999999/leer                                 # 404 y la sesión sigue viva (GET /api/usuario/me -> 200)
curl -X POST /api/marca -d '{"nombre":"<existente>"}'                       # 409 DB_UNIQUE_VIOLATION
# con DATABASE_URL inválido, cualquier request autenticada                  # 500, no 401
```

# Contrato de la API SmartLot

> Última actualización: 2026-10-25 (Fase 6 del plan "API REST"). El **inventario de endpoints** de la sección 6 se genera desde el router real y un test (`test/api-inventario.test.js`) falla si deja de coincidir con las rutas montadas. Las reglas de errores y escritura están en [`api-errores.md`](./api-errores.md).

## 1. Convenciones generales

- Base: `/api`. Cuerpos y respuestas en JSON (límite de cuerpo: 10 kB). Mensajes en español.
- **Sesión por cookies** `HttpOnly`: `access_token` (15 min) y `refresh_session_id` (30 días, `Path=/api/usuario/refresh`). También se acepta `Authorization: Bearer <token>`. Cada pedido autenticado vuelve a leer de la base el rol, empresa, sede y garages del usuario: el token solo identifica.
- **Roles** (ids): 1 admin · 2 empleado (cliente) · 3 garagista · 4 superadmin · 5 dueño de garage. El backend los identifica por número **y** por nombre (`src/helpers/roles.js`).
- IDs de ruta numéricos: `/api/marca/7abc` → 400 (ver [`api-errores.md` §5](./api-errores.md)).
- CORS: solo los orígenes de `CORS_ORIGIN`; otro origen → 403.

## 2. Formato de error

```json
{ "error": true, "message": "Texto en español", "statusCode": 409, "code": "DB_UNIQUE_VIOLATION" }
```

`code` es opcional. Detalle y política en [`api-errores.md`](./api-errores.md).

## 3. Códigos de estado

| Código | Cuándo |
|---|---|
| 200 / 201 / 202 | Éxito / recurso creado / aceptado sin revelar si ya existía (alta pública de solicitud). |
| 400 | Entrada inválida: id de ruta, campo obligatorio ausente, formato (incluye `DB_NOT_NULL_VIOLATION`, `DB_INVALID_FORMAT`, `DB_CHECK_VIOLATION`, `DB_VALUE_TOO_LONG`, `DB_VALUE_OUT_OF_RANGE`). |
| 401 | Sin sesión, sesión vencida o firma de webhook inválida. El frontend reacciona renovando la sesión. |
| 403 | Rol sin permiso, recurso de otro tenant (empresa/sede/garage) u origen CORS no permitido. |
| 404 | El recurso por id no existe (o no es visible para ese usuario) / ruta inexistente. |
| 409 | Conflicto de estado o de unicidad (`DB_UNIQUE_VIOLATION`, `DB_FOREIGN_KEY_VIOLATION`, `RESERVATION_LIMIT_REACHED`, día ya registrado, referencia de pago ambigua). |
| 500 | Falla interna (incluida la base). Nunca modifica la sesión. |
| 502 | Falla del proveedor de pagos (`MP_UPSTREAM_ERROR`). |
| 503 | Servicio no disponible (webhook sin secreto configurado; login con Google si el proveedor cae). |

## 4. `PUT` y `PATCH`

`PUT` reemplaza el recurso completo (falta un obligatorio → 400); `PATCH` actualiza solo lo enviado. Tabla de qué endpoint exige qué, y la lista de `PUT` parciales heredados, en [`api-errores.md` §6](./api-errores.md).

## 5. Autenticación: `login` vs. `GET /me`

Las dos respuestas **no tienen la misma forma** (el frontend lo absorbe en `AuthProvider`; unificarlas es trabajo del área frontend):

| | `POST /api/usuario/login` | `GET /api/usuario/me` |
|---|---|---|
| Cuerpo | `{ usuario, access_token, token_type, expires_in }` | `{ usuario }` |
| `usuario` | La fila de `usuarios` **sin** `contraseña` (nombre, apellido, email, teléfono, `activo`, `token_version`, `limite_reservas_activas` en snake_case, …) más `tipo_rol`, `id_garage`, `id_garages` | Los *claims* del token (`id`, `email`, `id_rol`, `id_empresa`, `id_sede`, `token_version`, `iat`, `exp`, …) **pisados** con los valores vigentes leídos de la base (`id_rol`, `id_empresa`, `id_sede`, `tipo_rol`, `id_garage`, `id_garages`). No trae nombre ni apellido |
| Fuente de verdad del rol | La base en el momento del login | La base en este pedido |

Los listados y `GET /api/usuario/:id` devuelven `limiteReservasActivas` (camelCase, una sola vez) y nunca el hash.

## 6. Inventario de endpoints

Cómo leerlo: **Acceso** es `pública`, `sesión` (cualquier rol autenticado) o `roles …` (además de la sesión). **Errores** son los que emite el controller más los comunes (401 si exige sesión, 403 si exige rol, 400 si la ruta tiene `:id` validado, 500). **Los services pueden agregar otros** — los más relevantes están en la sección 7.

<!-- INVENTARIO:INICIO (generado por scripts/generate-api-inventory.mjs; no editar a mano) -->

Roles: 1 admin · 2 empleado (cliente) · 3 garagista · 4 superadmin · 5 dueño de garage. Total: 137 endpoints en 18 módulos.

### `/api/empresa`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/empresa` | roles 4 | 200 | 401, 403, 500 |
| GET | `/api/empresa/auditoria` | roles 4 | 200 | 401, 403, 500 |
| GET | `/api/empresa/:id` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/empresa` | roles 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/empresa/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/empresa/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/garage`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/garage` | sesión | 200 | 401, 500 |
| GET | `/api/garage/cercanos` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| GET | `/api/garage/ocupacion_reserva/:id` | sesión | 200 | 400, 401, 404, 500 |
| GET | `/api/garage/ocupacion_no_reserva/:id` | sesión | 200 | 400, 401, 404, 500 |
| GET | `/api/garage/papelera` | roles 4, 5 | 200 | 401, 403, 500 |
| GET | `/api/garage/:id` | sesión | 200 | 400, 401, 404, 500 |
| GET | `/api/garage/:id/distancia-sede` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/garage` | roles 4, 5 | 201 | 400, 401, 403, 500 |
| POST | `/api/garage/propio` | roles 1, 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/garage/:id` | roles 4, 5 | 200 | 400, 401, 403, 404, 500 |
| GET | `/api/garage/:id/dias` | sesión | 200 | 400, 401, 500 |
| POST | `/api/garage/:id/dias` | roles 4, 5 | 201 | 400, 401, 403, 409, 500 |
| DELETE | `/api/garage/:id/dias/:dia` | roles 4, 5 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/garage/:id` | roles 4, 5 | 200 | 400, 401, 403, 404, 500 |
| PATCH | `/api/garage/:id/restaurar` | roles 4, 5 | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/garage/:id/ingreso-no-reserva` | roles 1, 3, 4 | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/garage/:id/egreso-no-reserva` | roles 1, 3, 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/marca`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/marca` | sesión | 200 | 401, 500 |
| GET | `/api/marca/:id` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/marca` | roles 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/marca/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/marca/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/modelo`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/modelo` | sesión | 200 | 401, 500 |
| GET | `/api/modelo/:id` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/modelo` | roles 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/modelo/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/modelo/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/reserva`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/reserva` | sesión | 200 | 401, 500 |
| GET | `/api/reserva/disponibilidad-por-hora` | sesión | 200 | 400, 401, 500 |
| POST | `/api/reserva/cotizacion` | roles 2 | 200 | 401, 403, 500 |
| GET | `/api/reserva/control-acceso/:id_garage` | roles 1, 3, 4 | 200 | 400, 401, 403, 500 |
| GET | `/api/reserva/usuario/:id_usuario` | sesión | 200 | 400, 401, 403, 500 |
| GET | `/api/reserva/:id/qr` | roles 2 | 200 | 400, 401, 403, 500 |
| GET | `/api/reserva/:id` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/reserva` | roles 2 | 201 | 400, 401, 403, 500 |
| PUT | `/api/reserva/:id` | sesión | 200 | 400, 401, 404, 500 |
| DELETE | `/api/reserva/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/reserva/:id/cancel` | roles 1, 2, 4 | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/reserva/:id/liberar-retencion` | roles 1, 2, 4 | 200 | 400, 401, 403, 500 |
| POST | `/api/reserva/qr/check-in` | roles 1, 3, 4 | 200 | 401, 403, 500 |
| POST | `/api/reserva/:id/check-in` | roles 1, 3, 4 | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/reserva/qr/check-out` | roles 1, 3, 4 | 200 | 401, 403, 500 |
| POST | `/api/reserva/:id/check-out` | roles 1, 3, 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/rol`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/rol` | sesión | 200 | 401, 500 |
| GET | `/api/rol/:id` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/rol` | roles 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/rol/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/rol/:id` | roles 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/sede`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/sede` | sesión | 200 | 401, 500 |
| GET | `/api/sede/:id` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/sede` | roles 1, 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/sede/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| PATCH | `/api/sede/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/sede/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/usuario`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/usuario` | roles 1, 4 | 200 | 401, 403, 500 |
| GET | `/api/usuario/garage/:id_garage` | roles 1, 3, 4, 5 | 200 | 400, 401, 403, 500 |
| POST | `/api/usuario/login` | pública | 200 | 400, 500 |
| POST | `/api/usuario/refresh` | pública | 200 | 401, 500 |
| POST | `/api/usuario/logout` | pública | 200 | 500 |
| POST | `/api/usuario/recuperar-clave` | pública | 200 | 500 |
| POST | `/api/usuario/login-con-codigo` | pública | 200 | 400, 500 |
| POST | `/api/usuario/restablecer-clave` | pública | 200 | 400, 500 |
| POST | `/api/usuario/impersonate` | roles 4 | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/usuario/stop-impersonate` | sesión | 200 | 401, 403, 409, 500 |
| GET | `/api/usuario/me` | sesión | 200 | 401, 500 |
| GET | `/api/usuario/auditoria` | roles 4 | 200 | 401, 403, 500 |
| GET | `/api/usuario/:id` | sesión | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/usuario/register` | pública | 201 | 400, 500 |
| POST | `/api/usuario/register-dueno-garage` | pública | 201 | 400, 500 |
| POST | `/api/usuario` | roles 1, 4 | 201 | 400, 401, 403, 500 |
| PATCH | `/api/usuario/:id/limite-reservas` | roles 1, 4 | 200 | 400, 401, 403, 500 |
| PUT | `/api/usuario/:id` | roles 1, 2, 3, 4, 5 | 200 | 400, 401, 403, 404, 500 |
| PATCH | `/api/usuario/:id/contrasenia` | roles 1, 4 (o el propio usuario) | 200 | 400, 401, 403, 404, 500 |
| PATCH | `/api/usuario/:id/estado` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/usuario/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/solicitud-registro`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| POST | `/api/solicitud-registro` | pública | 202 | 500 |
| GET | `/api/solicitud-registro` | roles 4 | 200 | 401, 403, 500 |
| GET | `/api/solicitud-registro/:id` | roles 4 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/solicitud-registro/:id/aprobar` | roles 4 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/solicitud-registro/:id/rechazar` | roles 4 | 200 | 400, 401, 403, 500 |

### `/api/vehiculo`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/vehiculo` | sesión | 200 | 401, 500 |
| GET | `/api/vehiculo/:id` | sesión | 200 | 400, 401, 404, 500 |
| POST | `/api/vehiculo` | roles 1, 2, 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/vehiculo/:id` | roles 1, 2, 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/vehiculo/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/auth`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/auth/google` | pública | 200 | 500 |
| POST | `/api/auth/google/callback` | pública | 200 | 400, 401, 403, 500, 503 |

### `/api/conflicto`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/conflicto` | roles 1, 4 | 200 | 401, 403, 500 |
| GET | `/api/conflicto/papelera` | roles 1, 4 | 200 | 401, 403, 500 |
| GET | `/api/conflicto/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| POST | `/api/conflicto` | roles 1, 2, 4 | 201 | 400, 401, 403, 500 |
| PUT | `/api/conflicto/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| DELETE | `/api/conflicto/:id` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |
| PATCH | `/api/conflicto/:id/restaurar` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/trato-empresa-garage`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/trato-empresa-garage` | roles 1, 2, 4, 5 | 200 | 401, 403, 500 |
| GET | `/api/trato-empresa-garage/empresa/:id_empresa` | roles 1, 2, 4, 5 | 200 | 400, 401, 403, 500 |
| GET | `/api/trato-empresa-garage/garage/:id_garage` | roles 1, 2, 4, 5 | 200 | 400, 401, 403, 500 |
| GET | `/api/trato-empresa-garage/:id` | roles 1, 2, 4, 5 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/trato-empresa-garage/:id/modalidad-pago` | roles 1, 4 | 200 | 400, 401, 403, 500 |
| POST | `/api/trato-empresa-garage` | roles 4 | 201 | 401, 403, 500 |
| PUT | `/api/trato-empresa-garage/:id` | roles 1, 4 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/trato-empresa-garage/:id/cancelar` | roles 1, 4 | 200 | 400, 401, 403, 404, 500 |

### `/api/solicitud-empresa-garage`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| POST | `/api/solicitud-empresa-garage` | roles 1 | 201 | 401, 403, 500 |
| GET | `/api/solicitud-empresa-garage/enviadas` | roles 1 | 200 | 401, 403, 500 |
| GET | `/api/solicitud-empresa-garage/recibidas` | roles 5 | 200 | 401, 403, 500 |
| PATCH | `/api/solicitud-empresa-garage/:id/aceptar` | roles 5 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/solicitud-empresa-garage/:id/rechazar` | roles 5 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/solicitud-empresa-garage/:id/autorizar-modificacion` | roles 5 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/solicitud-empresa-garage/:id/rechazar-modificacion` | roles 5 | 200 | 400, 401, 403, 500 |
| PATCH | `/api/solicitud-empresa-garage/:id/cancelar` | roles 1 | 200 | 400, 401, 403, 500 |
| GET | `/api/solicitud-empresa-garage/:id` | roles 1, 4, 5 | 200 | 400, 401, 403, 500 |

### `/api/notificacion`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/notificacion` | sesión | 200 | 401, 500 |
| GET | `/api/notificacion/no-leidas/count` | sesión | 200 | 401, 500 |
| PATCH | `/api/notificacion/:id/leer` | sesión | 200 | 400, 401, 500 |
| PATCH | `/api/notificacion/leer-todas` | sesión | 200 | 401, 500 |
| DELETE | `/api/notificacion/:id` | sesión | 200 | 400, 401, 500 |

### `/api/email-template`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/email-template` | roles 4 | 200 | 401, 403, 500 |
| GET | `/api/email-template/:codigo` | roles 4 | 200 | 401, 403, 500 |
| GET | `/api/email-template/:codigo/preview` | roles 4 | 200 | 401, 403, 500 |
| POST | `/api/email-template/:codigo/test` | roles 4 | 200 | 401, 403, 500 |
| PUT | `/api/email-template/:codigo` | roles 4 | 200 | 400, 401, 403, 500 |

### `/api/cuentas-corrientes`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| GET | `/api/cuentas-corrientes/admin` | roles 1 | 200 | 401, 403, 500 |
| GET | `/api/cuentas-corrientes/dueno` | roles 5 | 200 | 401, 403, 500 |

### `/api/payments`

| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |
|---|---|---|---|---|
| POST | `/api/payments/preference` | roles 1, 2, 4 | 200/201 | 400, 401, 403, 409, 500 |
| GET | `/api/payments/webhook-events` | roles 4 | 200 | 401, 403, 500 |
| POST | `/api/payments/verificar` | roles 1, 2, 4 | 200 | 401, 403, 500 |
| GET | `/api/payments/:paymentId` | roles 1, 2, 4 | 200 | 401, 403, 500 |
| POST | `/api/payments/:paymentId/verificar` | roles 1, 2, 4 | 200 | 401, 403, 500 |
| POST | `/api/payments/webhook` | pública | 200 | 400, 401, 409, 500, 503 |
| POST | `/api/payments/:paymentId/refund` | roles 4 | según resultado | 401, 403, 500 |
| GET | `/api/payments` | roles 1, 2, 4 | 200 | 401, 403, 500 |

<!-- INVENTARIO:FIN -->

## 7. Códigos que agregan los services (no se ven en el inventario)

| Endpoint(s) | Código | Cuándo |
|---|---|---|
| `POST /api/reserva` | 409 `RESERVATION_LIMIT_REACHED` (con `details`) | El empleado alcanzó su límite de reservas activas |
| `POST /api/garage/:id/dias`, `GET /api/garage/:id/dias` | 404 | El garage no existe |
| `PUT/PATCH /api/sede/:id`, `DELETE /api/sede/:id` | 404 / 403 | Sede inexistente o de otra empresa / destino no autorizado |
| `POST /api/payments/verificar`, `…/:paymentId/verificar` | 400 `invalid_filter`, `invalid_payment_id` | `externalReference` ausente o inválido / `paymentId` no numérico |
| `GET /api/payments/:paymentId` | 400 `invalid_payment_id`, 404 `payment_not_found` | `paymentId` no numérico / no hay un pago local autorizado con ese id (o aún no se sincronizó) |
| `POST /api/payments/verificar`, `…/:paymentId/verificar` | 404 `payment_not_found`, 409 `payment_reference_conflict`, `ambiguous_payment_reference`, `payment_sync_conflict` | Pago desconocido para Mercado Pago / referencias contradictorias o ambiguas |
| `POST /api/payments/*`, `…/refund` | 502 `MP_UPSTREAM_ERROR` | Falla de Mercado Pago |
| `POST /api/payments/:paymentId/refund` | 409 y códigos de `manualRefundService` | Reembolso no permitido / estado inconsistente |
| `POST /api/solicitud-registro` | 202 siempre (si es válida) | No revela si el correo ya existe |

## 8. Cómo mantener este documento

1. Cambió una ruta, un rol o un status literal → `npm run routes:inventory -- --write` regenera la sección 6.
2. `test/api-inventario.test.js` falla si el bloque generado está desactualizado o si una ruta del router no figura.
3. Cambió un contrato (formato de error, semántica de escritura, flujo de pagos) → actualizar [`api-errores.md`](./api-errores.md) y, si la decisión es costosa de revertir, escribir un ADR (repo del frontend: `docs/decisions/`).
4. La colección Postman (`src/postman/SmartLot.postman_collection.json`) cubre los endpoints principales y los casos de error documentados.

# Re-auditoría de seguridad (rama `security-improvement`)

> Fecha: 2026-11-18. Alcance: backend (`SmartLot_API`, desde `master` 154a71f) y frontend
> (`SmartLot`, desde `main` ef19f26). Punto de partida: área **2.4 Seguridad** del Informe
> Docente del 2026-10-16 (nota 5/10) y los ítems de otras áreas con impacto de seguridad.

## 1. Metodología

Se usó la skill **security-audit de Cloudflare** (`npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit`),
en *modo guía* (revisión enfocada de hallazgos conocidos), con sus reglas:

- **Frontera y resultado.** Un hallazgo cuenta solo si se puede nombrar quién lo explota (principal de
  menor confianza), qué control debía frenarlo, qué frontera cruza (empresa, sede, garage, cuenta) y qué
  resultado concreto produce. Las "buenas prácticas" sin resultado quedan como endurecimiento.
- **Evidencia local acotada.** Cada hallazgo nuevo tiene una reproducción sobre PostgreSQL aislado
  (PGlite) con los controllers, el middleware y el SQL reales:
  [`test/seg11-autorizacion-sql.integration.test.js`](../test/seg11-autorizacion-sql.integration.test.js).
  Corrido contra `master` fallan 14 de sus 16 casos (el 2 es un control positivo; el 14 prueba el helper
  nuevo de reversión, cuyo cableado cubre `manual-refund-route.test.js`); en esta rama pasan todos.
- **Recorrer todas las puertas.** "La política efectiva es la de la puerta más débil": para cada recurso se
  revisaron *todas* las rutas que lo leen o lo escriben, no solo la del ejemplo del informe. El resultado
  es la matriz de la sección 4.
- **El arreglo más chico en el último punto de decisión confiable**, con test de regresión.

Skill instalada a nivel usuario (`~/.claude/skills/security-audit`), sin versionarla: el informe ya
marcaba como problema las ~52k líneas de skills de terceros dentro de los repos.

## 2. Estado de cada hallazgo de seguridad del informe

| # | Sev. (informe) | Hallazgo | Estado | Dónde |
|---|---|---|---|---|
| 1 | CRÍTICO | Cualquier usuario reembolsa cualquier pago | **Cerrado** (SEG-01) + la reserva reembolsada ya no queda confirmada (esta rama) | `paymentController.js` `POST /:paymentId/refund` → `requireRole(4)`; `manualRefundService.js` valida pago local ↔ MP, saldo e idempotencia; `reservationPaymentReversal.js` |
| 2 | ALTO | Listado global de pagos y de eventos de webhook | **Cerrado** (SEG-02) | `paymentReadService.js` (autorización dentro del SQL, antes de filtros y paginación); `GET /webhook-events` → `requireRole(4)` |
| 3 | ALTO | Monto y consumos "PAGADA" decididos por el cliente; prefijo `ADMIN-PAGO-` con tope de $0,10 | **Cerrado** (SEG-03) | `enterprisePaymentService.createEnterprisePreference`: el servidor suma los consumos (`FOR UPDATE`), no hay prefijo ni tope; la relación pago↔consumo es la tabla `enterprise_payment_consumptions` |
| 4 | ALTO | Escrituras sin aislamiento por empresa (sedes, estado/baja de usuarios, cancelar/liberar reservas, ingreso/egreso sin reserva) | **Cerrado** (SEG-04) y **extendido** a vehículos, check-in/out y alta de garagistas (esta rama) | `helpers/writeAuthorization.js` + `writeTenantFilter.js` (el filtro va también en el `UPDATE`) |
| 5 | MEDIO | Logout que revoca sesiones ajenas con `jwt.decode` | **Cerrado** (799b1ae) + el access token muere en el acto (esta rama) | `helpers/logoutCredential.js` (`jwt.verify` HS256); `authMiddleware` compara `token_version` |
| 6 | MEDIO | Código de recupero sin límite de intentos | **Cerrado** (SEG-06) + límite por cuenta en login/clave (esta rama) | `recoveryService.js`: `crypto.randomInt`, 5 fallos, 10 min, uso único; `rateLimiterMiddleware.credentialRateLimiter` |
| 7 | BAJO | El registro público devolvía el hash | **Cerrado** (SEG-07) | `solicitudRegistroService._sanitizarSolicitud` |
| 8 | BAJO | Webhook *fail-open* sin `MP_WEBHOOK_SECRET` | **Cerrado** (SEG-08) | `POST /webhook` responde 503 sin secreto; firma HMAC con `timingSafeEqual` y `data.id` ligado |
| 9 | BAJO | Login con Google sin verificar proveedor | **Cerrado** (SEG-09) | `helpers/googleIdentity.js` |
| 10 | BAJO | Enumeración de cuentas / HTML sin escapar en plantillas de respaldo | **Cerrado** (SEG-10A/10B) + escape de las plantillas de respaldo (esta rama) | login con hash señuelo y respuesta única; `emailService.enviarCorreoDesdePlantilla` escapa las variables |
| 11 | SUGERENCIA | Cambio de contraseña sin pedir la actual | **Cerrado** (esta rama) | `usuarioService._exigirContraseñaActualAsync`; frontend: perfiles de empleado y dueño |
| 12 | SUGERENCIA | TLS a la base con `rejectUnauthorized: false` por defecto | **Riesgo aceptado, documentado** | `database/db.js`: con `DB_CA_CERT` valida estricto; `.env.example` lo explica (ver §5) |

Ítems de otras áreas del informe con impacto de seguridad:

| Área | Hallazgo | Estado |
|---|---|---|
| API | GET de pagos que escribían ("adoptar" un pago leyéndolo) | Cerrado (62cd310): los GET son de solo lectura; sincronizar es `POST .../verificar` |
| API | Un 500 borraba las cookies; `authMiddleware` respondía 401 si caía la base | Cerrado (62cd310) |
| Arquitectura | `savePaymentRecord` recibía la transacción pero escribía con `pool` | Cerrado: todas sus consultas usan `db` |
| Base de datos | Vocabulario de roles: el backend preguntaba por `superadmin`/`cliente` y la base dice `smartlot`/`empleado` | **Cerrado (esta rama)**: se autoriza por ID (ver R-08) |
| Base de datos | `reservas.dia` lo mandaba el cliente y pasaba el control de días hábiles | **Cerrado (esta rama)** (R-04) |
| Repositorio | Backend sin `.env.example`; restos de depuración commiteados (`cookies.txt`, `in`, `debug_reserva*.js`, logs) | **Cerrado (esta rama)**; `cookies.txt` ya se había quitado en 99677e5 |
| Repositorio | Dependencias sin uso (más superficie) | **Cerrado (esta rama)**: BE `routes`; FE `dotenv`, `html2canvas`, `react-icons` |
| Estándares | Política de contraseña distinta entre frontend y backend | **Cerrado (esta rama)**: una sola política fuerte en todas las vías |

## 3. Hallazgos nuevos de esta re-auditoría

El informe advertía que el reembolso era "un faro, no la lista completa". Recorriendo todas las puertas
aparecieron estos, todos confirmados con reproducción local y arreglados:

| ID | Sev. | Quién → qué | Resultado antes del arreglo | Arreglo | Test |
|---|---|---|---|---|---|
| R-01 | Alta | Admin de la empresa A → `PUT/DELETE /api/vehiculo/:id`, `POST /api/vehiculo` | Editaba, reasignaba y borraba vehículos de cualquier empresa; creaba vehículos para usuarios de otra | `vehiculoService` usa `authorizeWrite` (global / empresa-sede / propio) y `vehiculoRepository` lleva el filtro en el `UPDATE`; el titular nuevo tiene que estar en el alcance | `vehiculos: un admin no edita...` |
| R-02 | Media | Empleado → `GET /api/vehiculo`, `GET /api/reserva(/:id)` | Veía patentes y reservas de todos sus compañeros de sede | `getTenantCondition` con `ownerColumn`: el empleado solo ve lo propio (mismo alcance que sus escrituras) | `empleado: solo ve sus vehiculos...` |
| R-03 | Alta | Empleado → `PUT /api/reserva/:id` | Pagaba 1 h y extendía a 10 h, o movía la reserva a otro garage/vehículo, conservando trato, cupo, responsable e importe del alta | La edición recotiza con la misma regla que el alta (`_quoteWithClientAsync`); si ya se pagó o hay una preferencia de MP emitida y el precio cambia → 409 `RESERVATION_REPRICE_REQUIRED` | `reserva pagada: extender...`, `reserva pendiente...`, `mover al garage propio...` |
| R-04 | Media | Empleado → `POST/PUT /api/reserva` | `dia` lo decidía el cliente (un lunes con `dia='Sabado'`); el alta no validaba días ni horario del garage | El servidor deriva `dia` de `fecha_entrada`; alta y edición comparten `_validarHorarioGarage` | `reserva pendiente sin pago: ... el dia lo calcula el servidor` |
| R-05 | Media | Admin → `POST /api/usuario` con rol garagista | Podía crear un garagista para un garage de terceros (visible por trato) y, con él, leer nombres y patentes de reservas de otras empresas y operar ese garage | Solo para el garage propio de una sede de su empresa | `alta de garagista...` |
| R-06 | Media | Admin → `POST /api/reserva/:id/check-in` / `check-out` (y por QR) | En un garage con trato compartido marcaba ingreso/egreso de reservas de otra empresa (el egreso genera el consumo facturado) | Solo reservas de su empresa/sede, el mismo alcance con el que control-acceso se las muestra | `check-in: un admin no registra...` |
| R-07 | Media | Quien tenga un access token robado o el de una sesión ya cerrada | Logout, cambio/restablecimiento de clave, desactivación y baja subían `token_version`, pero el middleware no lo miraba: el token seguía sirviendo hasta 15 min | `authMiddleware` compara `token_version` con la base; los tokens de impersonación la incluyen | `sesion: despues del logout...` |
| R-08 | Media | Cualquiera que pueda crear roles (o un `tipo_rol` repetido) | `hasRole` comparaba nombres: las ramas `superadmin`/`cliente` nunca coincidían con la base y un rol nuevo llamado `admin` heredaba los permisos del 1 | `hasRole` traduce nombres a los IDs fijos de `docs/roles.sql` y compara solo IDs | `roles: se autoriza por ID...` |
| R-09 | Media | Sesión robada → `PATCH /:id/contrasenia`, `PUT /:id` (email o contraseña) | Cambiaba la contraseña sin la actual (y por `PUT` sin revocar sesiones), o el email para después usar "olvidé mi contraseña" | Contraseña actual obligatoria para cambiar la propia clave o el propio email; el `PUT` ya no acepta contraseña | `clave propia...`, `email propio...`, `clave: una politica unica...` |
| R-10 | Media | Empleado que pagó su reserva | Contracargo o reembolso total dejaban la reserva confirmada con QR vigente | Webhook (`charged_back`, `payment.refunded`) y reembolso manual cancelan la reserva confirmada sin ingreso | `pago revertido...`; `manual-refund-route.test.js` |
| R-11 | Baja | Cualquiera (registro público de empresa) | Nombre de solicitante/empresa sin escapar en el mail de respaldo al superadmin (HTML y enlaces inyectables) | Se escapan todas las variables, como en las plantillas de la base | `email-service.test.js` |
| R-12 | Baja | Fuerza bruta sobre una cuenta | Único límite: 100 pedidos / 3 min por IP, sobre cualquier cuenta | `credentialRateLimiter`: 10 fallos por cuenta e IP en 15 min (login, login con código, restablecer y cambiar clave) | `login: 10 intentos fallidos...` |
| R-13 | Alta (DoS) | Cualquiera, endpoints públicos | `body-parser` 2.0–2.3 (DoS con cuerpo comprimido), `undici`, `follow-redirects`; en el FE `dompurify` (crítica, la usa `jspdf`) | `npm audit fix`: 0 vulnerabilidades conocidas en dependencias de producción en los dos repos | `npm audit --omit=dev` |
| R-14 | Baja | — | `POST /api/usuario/register` (público, sin uso en el frontend) le daba a cualquiera una cuenta con la que iniciar sesión: fue el primer paso del CRÍTICO | Retirado; los empleados los da de alta el admin de su empresa | inventario regenerado |
| R-15 | Baja | — | Un 500 devolvía el `code` del driver o del sistema (`42P01`, `ECONNREFUSED`) | `errorHandler` no lo incluye en los 500 sin status explícito | suite existente |

## 4. Matriz de autorización de las operaciones que modifican algo

Rol = lo que exige la ruta (`requireRole`). Pertenencia = dónde se verifica que el recurso sea de quien lo
pide. Ninguna fila queda con la segunda columna vacía. Las decisiones de alcance salen de **un solo lugar**
(`writeAuthorization.js` + `writeTenantFilter.js`, o el helper de su dominio) en lugar de depender de que
cada método se acuerde.

| Operación | Rol | Pertenencia / dónde se verifica |
|---|---|---|
| `POST/PUT/DELETE /api/empresa` | 4 | Global (solo superadmin) |
| `POST/PUT/DELETE /api/marca`, `/api/modelo`, `/api/rol` | 4 | Catálogo global (solo superadmin) |
| `POST /api/sede` | 1, 4 | `sedeService.createAsync`: `authorizeSiteCompany` (admin solo en su empresa; admin de sede no crea) |
| `PUT/PATCH/DELETE /api/sede/:id` | 1, 4 | `sedeRepository.getForWriteAsync` + filtro en el `UPDATE` (empresa y sede) |
| `POST /api/garage` | 4, 5 | `garageService.createAsync`: el dueño queda como dueño de su garage; asignar dueño/garagistas solo superadmin |
| `POST /api/garage/propio` | 1, 4 | `garageService.createPropioAsync`: la sede tiene que ser de su empresa (y de su sede) |
| `PUT /api/garage/:id`, `POST/DELETE .../dias`, `DELETE /api/garage/:id` | 4, 5 | `assertGarageControl` → `garageRepository.getByIdAsync` (dueño: `usuario_garage`) |
| `PATCH /api/garage/:id/restaurar` | 4, 5 | `garageRepository.restoreAsync` con el mismo filtro |
| `POST /api/garage/:id/ingreso-no-reserva`, `egreso-no-reserva` | 1, 3, 4 | `authorizeGarageOccupancy` + `occupancyFilter` (garagista asignado; admin solo garage propio) |
| `POST /api/reserva`, `POST /api/reserva/cotizacion` | 2 | Titular = actor; vehículo propio y trato de su sede (`_quoteWithClientAsync`) |
| `PUT /api/reserva/:id` | sesión | `reservaRepository.getByIdAsync` con tenant (empleado: propio) + chequeo de titular; recotiza |
| `DELETE /api/reserva/:id`, `POST .../cancel`, `POST .../liberar-retencion` | 1, 2, 4 | `authorizeWrite(actor, true)` + `writeTenantFilter` en lectura y `UPDATE` |
| `POST /api/reserva/:id/check-in`, `check-out`, `qr/check-in`, `qr/check-out` | 1, 3, 4 | `_validarReservaParaAccesoAsync`: garagista asignado al garage; admin solo reservas de su empresa/sede; patente |
| `POST /api/usuario` | 1, 4 | Controller: escalada de roles, empresa forzada a la del admin, sede de su empresa, garagista solo en garage propio |
| `PUT /api/usuario/:id` | 1–5 | `authorizeUserEdit` + `getForEditAsync` con filtro + `authorizeUserEditDestination`; email propio con contraseña actual |
| `PATCH /api/usuario/:id/contrasenia` | 1, 4 o el propio | Igual que el `PUT`; el propio usuario envía la contraseña actual; revoca sesiones |
| `PATCH /api/usuario/:id/estado`, `DELETE /api/usuario/:id` | 1, 4 | `_changeLifecycleAsync`: `authorizeWrite` + filtro; un admin no toca al superadmin |
| `PATCH /api/usuario/:id/limite-reservas` | 1, 4 | `usuarioRepository.updateReservationLimitAsync`: empleado de su empresa/sede |
| `POST /api/usuario/impersonate` | 4 | Solo superadmin; el token lleva `impersonated_by` firmado |
| `POST /api/usuario/stop-impersonate` | sesión | `impersonated_by` del token verificado; el destino tiene que ser rol 4 |
| `POST /api/usuario/logout` | pública | `verifyLogoutCredential` (`jwt.verify`); revoca solo la cuenta del token válido |
| `POST /api/usuario/recuperar-clave`, `login-con-codigo`, `restablecer-clave` | pública | Código atado a la cuenta, uso único, 5 fallos, límites por cuenta |
| `POST /api/usuario/register-dueno-garage` | pública | El servidor fija rol 5 y tenant vacío |
| `POST /api/solicitud-registro` | pública | Respuesta única 202 (sin enumeración), hash nunca devuelto |
| `PATCH /api/solicitud-registro/:id/aprobar`, `rechazar` | 4 | Global (solo superadmin) |
| `POST /api/vehiculo`, `PUT /api/vehiculo/:id` | 1, 2, 4 | `vehiculoService`: `authorizeWrite(actor, true)`; titular dentro del alcance; filtro en el `UPDATE` |
| `DELETE /api/vehiculo/:id` | 1, 4 | `vehiculoRepository.deleteAsync` con el filtro de alcance |
| `POST /api/conflicto` | 1, 2, 4 | Empleado y admin: `id_usuario` forzado al actor |
| `PUT/DELETE /api/conflicto/:id`, `PATCH .../restaurar` | 1, 4 | `ConflictoRepository` con condición de tenant en cada `UPDATE` |
| `POST /api/trato-empresa-garage` | 4 | Solo superadmin (el admin propone con una solicitud) |
| `PUT /api/trato-empresa-garage/:id`, `PATCH .../modalidad-pago`, `PATCH .../cancelar` | 1, 4 | `tratoEmpresaGarageService._adminCanManage` (empresa y sede del trato) |
| `POST /api/solicitud-empresa-garage` | 1 | `createPendingAsync`: la sede tiene que ser de la empresa del admin |
| `PATCH .../aceptar`, `rechazar`, `autorizar-modificacion`, `rechazar-modificacion` | 5 | El dueño tiene el garage en `usuario_garage` (dentro de la transacción) |
| `PATCH /api/solicitud-empresa-garage/:id/cancelar` | 1 | Solo la empresa solicitante |
| `PATCH /api/notificacion/:id/leer`, `leer-todas`, `DELETE /api/notificacion/:id` | sesión | `WHERE id_usuario = actor` en el SQL |
| `PUT /api/email-template/:codigo`, `POST .../test` | 4 | Global (solo superadmin) |
| `POST /api/payments/preference` | 1, 2, 4 | Empleado: reserva propia con su importe persistido; empresa: consumos de su empresa/sede sumados en el servidor |
| `POST /api/payments/verificar`, `POST /api/payments/:paymentId/verificar` | 1, 2, 4 | `paymentReadService`: el pago tiene que ser visible para el actor antes de sincronizar |
| `POST /api/payments/:paymentId/refund` | 4 | Solo superadmin; pago local coherente con MP; idempotente |
| `POST /api/payments/webhook` | pública | Firma HMAC de MP; el pago se vuelve a consultar a MP por id |

Lecturas sensibles con el mismo criterio: pagos (`paymentReadService`, autorización en SQL), reservas y
vehículos (`getTenantCondition`, empleado solo propio), usuarios (`GET /:id` propio o admin del tenant),
cuentas corrientes (empresa/sede del admin, garages del dueño), notificaciones (propias).

## 5. Riesgos aceptados y fuera de alcance

- **TLS a la base sin validar el certificado** si no se configura `DB_CA_CERT` (el pooler de Supabase
  presenta una cadena que Node no valida). La conexión va cifrada; para validación estricta basta con
  cargar el CA en `DB_CA_CERT`. No es verificable desde el repositorio (depende del despliegue).
- **RLS activo sin policies**: equivale a "deny all" para `anon`/`authenticated` en PostgREST; el backend
  entra con la cadena de servicio. Coherente con que el frontend nunca hable directo con Supabase.
- **`picomatch`** (ReDoS) queda en el frontend: lo usa Vite al compilar y no llega al bundle; arreglarlo
  exige un cambio de versión mayor de Vite.
- **`npm run check:security`** marca 8 "posibles SQL injection" en `solicitudEmpresaGarageRepository` y
  `tratoEmpresaGarageRepository`: son falsos positivos, el fragmento interpolado es la constante
  `DETAIL_SELECT` y los valores van como `$n`.
- **Webhook**: no se controla la antigüedad de `ts` de la firma. Repetir una notificación no tiene efecto
  propio porque el handler vuelve a consultar el pago a Mercado Pago.
- **Registro de dueño de garage**: responde distinto si el email ya existe. Es el comportamiento normal de
  un alta con inicio de sesión inmediato y queda limitado por los dos limitadores.
- **Frontend**: `helpers/qrReserva.js` decide con estados de más si mostrar el QR; es solo interfaz, el
  backend valida el QR (`getQrAsync` exige reserva propia y `confirmada`).

## 6. Cómo verificarlo

```bash
cd SmartLot_API
npm ci
npm test                                   # 823 tests, 0 fallas (9 omitidos que necesitan servicios reales)
node --experimental-test-module-mocks --test test/seg11-autorizacion-sql.integration.test.js
npm audit --omit=dev                       # 0 vulnerabilidades

cd ../SmartLot   # (repo del frontend)
npm ci && npm test                         # 160 tests, 0 fallas
npm audit --omit=dev                       # 0 vulnerabilidades
```

## 7. Commits

Backend (`security-improvement`): 46eae7d roles por ID · 74e0486 vehículos · 5377452 reservas ·
ad042d7 credenciales y sesión · 11e93a7 pago revertido · f75268c mails y 500 · 0aff525 tests ·
b4d9fd2 higiene y dependencias · b8fefee límite por cuenta · dd649aa + 94a7954 check-in del admin.
Frontend (`security-improvement`): 7ac0229 contraseña actual y política única · e8f4639 dependencias.

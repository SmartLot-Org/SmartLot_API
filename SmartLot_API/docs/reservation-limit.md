# Límite opcional de reservas vigentes por empleado

Implementación en el estado local de SmartLot_API y SmartLot, sin cambios en Supabase remoto. La migración local documenta la migración remota `20261001123359_add_user_active_reservation_limit` y es idempotente. No actualiza filas existentes.

## Política y definición exacta

`usuarios.limite_reservas_activas`: `NULL` sin máximo; `0` bloquea nuevas reservas; entero positivo hasta `32767` establece el máximo global del empleado. No depende del garage, trato, cupo ni responsable de pago. Bajar el límite no modifica las reservas existentes. Guardar `NULL` elimina el bloqueo.

Una reserva cuenta exactamente cuando:

```sql
"Borrado" = false
AND estado_reserva IN ('pendiente_pago', 'confirmada')
AND (
    (estado_reserva = 'pendiente_pago' AND retencion_pago_hasta > NOW())
    OR (
        estado_reserva = 'confirmada' AND salio = false
        AND (
            fecha_salida >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')
            OR entro = true
        )
    )
)
```

`fecha_salida` se compara como timestamp local argentino; la retención conserva la comparación contra `NOW()` del flujo existente. Las pruebas SQL corren con la sesión PostgreSQL en UTC para detectar el desplazamiento accidental de tres horas.

## Endpoint y aislamiento

`PATCH /api/usuario/:id/limite-reservas`

```json
{ "limiteReservasActivas": 2 }
```

También acepta `null`. Rechaza omitidos, strings, decimales, negativos, valores fuera de smallint y JSON mal formado. Responde sólo `{ "idUsuario": 123, "limiteReservasActivas": 2 }`.

Usa autenticación JWT y `requireRole`, con roles existentes: administrador de empresa, administrador de sede y superadmin. El repositorio vuelve a comprobar el tenant contra el empleado bloqueado. Sólo utiliza `req.usuario` para identificar al actor, empresa y sede; ignora campos de tenant/auditoría enviados por el cliente. El objetivo debe ser un empleado activo no borrado. Actualiza exclusivamente el límite, `UpdateBy` y `UpdateAt`.

Estados: `400` valor inválido; `401` sesión ausente/inválida; `403` rol, empresa o sede sin autorización; `404` empleado activo inexistente. La creación devuelve `409`, `code: RESERVATION_LIMIT_REACHED` y `details: { limit, current }` cuando se alcanza el máximo.

Los listados de empleados agregan `limiteReservasActivas`, manteniendo los campos originales. El alta administrativa acepta el campo opcional; omitirlo guarda `NULL`. El PUT general no persiste este campo.

## Creación, cotización y edición

La creación conserva la transacción del servicio: expira retenciones, lee y bloquea `usuarios` con `FOR UPDATE OF u`, cuenta en una consulta posterior, comprueba el máximo y continúa con vehículo, solapamiento, garage, trato, capacidad, tipo, tarifa y modalidad de pago. Inserta y confirma antes de liberar el bloqueo. Esto serializa incluso solicitudes para garages diferentes. Una actualización administrativa del límite también bloquea esa fila, por lo que se ordena con las creaciones concurrentes. Los errores de conteo se propagan y no se convierten en cero.

La cotización devuelve `politicaReservas` con `sinLimite`, `limite`, `activas` y `restantes`. Sin límite usa `null`, nunca `Infinity`. No sustituye la comprobación al insertar.

La edición mantiene el lugar de la reserva vigente sin volver a sumarla, incluso si se bajó el límite. Bloquea al empleado y a la reserva, comprueba que siga vigente y no permite reactivar una expirada/cancelada/borrada ni cambiar titular, estado, pago o acceso mediante el PUT. Conserva las validaciones existentes de edición y aplica el tenant al leer la reserva. Se eliminan la validación diaria hardcodeada y su consulta que devolvía cero ante fallos.

## Frontend

Gestión de empleados incluye indicador y modal con Sin límite/Limitar reservas, validación de entero, explicación de cero, guardar/cancelar, estado de carga y errores reales. Usa `UsuariosPatchLimiteReservas` con el `apiClient` existente. Invalida únicamente la caché de usuarios y actualiza el empleado con la respuesta, sin recargar la aplicación. El alta inicia Sin límite y envía `null`.

El flujo de reserva muestra la política de la cotización e interpreta el código específico en el camino corporativo y en el pago del empleado. Cero se explica como bloqueo temporal de nuevas reservas. Se preserva la reutilización de una retención de pago vigente. Se elimina el mensaje antiguo de dos reservas diarias. React no se conecta a Supabase.

## Archivos

Backend:

- `src/helpers/reservationPolicy.js` (nuevo)
- `src/controllers/usuarioController.js`
- `src/entities/Usuario.js`
- `src/middlewares/errorHandler.js`
- `src/repositories/reservaRepository.js`
- `src/repositories/usuarioRepository.js`
- `src/services/reservaService.js`
- `src/services/usuarioService.js`
- `test/reserva-repository.test.js`
- `test/reservation-policy.test.js` (nuevo)
- `test/reservation-limit.integration.test.js` (nuevo)
- `migrations/20261001_001_add_user_active_reservation_limit.sql` (nuevo)
- `docs/reservation-limit.md` (nuevo)

Frontend:

- `src/helpers/reservationPolicy.js` (nuevo)
- `src/helpers/reservationPolicy.test.js` (nuevo)
- `src/helpers/erroresMensajes.js`
- `src/servicies/API_Usuario.js`
- `src/vistasAdmin/gestion_de_empleados.jsx`
- `src/vistasAdmin/gestion_de_empleados.css`
- `src/vistasAdmin/agregar_empleado.jsx`
- `src/vistasEmpleados/nueva_reserva.jsx`

## Verificación ejecutada

| Comando | Resultado |
| --- | --- |
| Backend: suite local sin `test/mp-integration.test.js` | 213 aprobadas; 0 fallos; 0 omitidas. Incluye PostgreSQL real, no un mock de concurrencia. |
| Backend: última ejecución dirigida de política, repositorio e integración PostgreSQL | 23 aprobadas; 0 fallos; 0 omitidas. |
| Backend: `npm test`, con PostgreSQL local y HTTP externo bloqueado | 214 aprobadas, 3 fallos, 3 omitidas en esa ejecución. Fallos detallados abajo. |
| Backend: `npm run check:syntax` | Aprobado. |
| Backend: `npm run check:routes` | Aprobado. |
| Backend: `npm run check:security` | Falló por hallazgos en archivos ajenos al cambio; detalles abajo. |
| Frontend: `npm test` | 100 aprobadas; 0 fallos. |
| Frontend: `npm run lint` | 113 errores y 6 advertencias en archivos sin modificar; detalles abajo. |
| Frontend: ESLint de todos los JS/JSX modificados y nuevos | Aprobado sin errores ni advertencias. |
| Frontend: `npm run build` | Aprobado; advertencia por chunks superiores a 500 kB. |
| Ambos: `git diff --check` | Aprobado. |

La suite local verifica los casos solicitados: NULL, cero, tercera reserva, retención vigente/vencida, futura, en uso con horario vencido, completada, cancelada/expirada/borrada, empresa/empleado, propio/externo, dentro/extra, reducción sin cambios a reservas/pagos, eliminación del máximo, edición, dos peticiones HTTP concurrentes y espera real del bloqueo, autorización por rol/empresa/sede, errores frontend y eliminación de la regla diaria. Las suites existentes de pago, QR, garages y cuentas corrientes se ejecutaron también; esto no equivale a validar el checkout externo real.

### Fallos de la suite completa de backend

Se ejecutó con `DATABASE_URL` apuntando a PostgreSQL local, un token de prueba sin credenciales y un preload temporal que bloqueaba HTTP externo, para evitar escrituras remotas. Los tres fallos pertenecen a `test/mp-integration.test.js`, archivo sin modificar:

- Línea 41, `crea preferencia de pago real y devuelve init_point`: `MPConnectionError: External HTTP disabled for local verification`.
- Línea 55, `busca pagos reales por external_reference`: el mismo error por bloqueo de HTTP externo.
- Línea 120, `webhook HTTP con firma valida pero pago inexistente marca el evento con error`: esperaba 404, obtuvo 500; la base aislada no tiene `webhook_eventos`. No se crearon tablas ni se cambiaron webhooks para resolver esta dependencia ajena a la tarea.

Son limitaciones del entorno de verificación aislado; no se afirma que estas integraciones externas pasen. Tres pruebas que requieren credenciales de Mercado Pago quedaron omitidas en la ejecución completa.

### Hallazgos del chequeo de seguridad

Archivos sin modificar:

- `src/repositories/solicitudEmpresaGarageRepository.js`: líneas 86, 91 y 97, advertencias de posible SQL injection por template literal.
- `src/repositories/tratoEmpresaGarageRepository.js`: líneas 16, 17, 18, 21 y 22, las mismas advertencias.
- `src/services/mpService.js:126`: advertencia de log con datos sensibles.
- También advierte sobre la presencia del `.env` local. No se cambió ni se copió su contenido.

### Reproducción de las pruebas PostgreSQL

Requiere PostgreSQL local y un usuario con permiso para crear un esquema aislado. La prueba valida que el host sea localhost/loopback, crea un esquema con nombre único y lo elimina al finalizar. Nunca utiliza `DATABASE_URL` como sustituto de esta variable.

```powershell
$env:TEST_RESERVATION_DATABASE_URL = 'postgres://postgres@127.0.0.1:55439/postgres'
node --experimental-test-module-mocks --test test/reservation-limit.integration.test.js
```

Sin esa variable, la integración local queda explícitamente omitida. Las pruebas unitarias de política y frontend no requieren base de datos. No se ejecutó una prueba manual de UI en navegador ni un checkout real de Mercado Pago. No quedan decisiones funcionales pendientes; queda pendiente la verificación externa en un ambiente preparado para esas integraciones y resolver los hallazgos anteriores de lint/seguridad fuera de esta tarea.

### Archivos reportados por npm run lint

Todos los archivos de esta lista permanecen sin modificar. El lint dirigido de los archivos de la funcionalidad pasa.

- `.agents/skills/impeccable/scripts/live-browser-dom.js`: 1 errores, 0 advertencias; no-empty.
- `.agents/skills/impeccable/scripts/live-browser.js`: 38 errores, 0 advertencias; no-dupe-keys, no-empty, no-unsafe-finally, no-unused-vars, no-useless-assignment.
- `.agents/skills/impeccable/scripts/modern-screenshot.umd.js`: 10 errores, 0 advertencias; no-control-regex, no-redeclare, no-undef, no-useless-escape, require-yield.
- `src/componentesAdmin/admin_dashboard_boton.jsx`: 3 errores, 0 advertencias; no-unused-vars, react-hooks/refs.
- `src/componentesAdmin/boton_generico.jsx`: 1 errores, 0 advertencias; no-unused-vars.
- `src/componentesAdmin/boton_reportes.jsx`: 1 errores, 0 advertencias; no-unused-vars.
- `src/componentesAdmin/formulario_infoPersonal.jsx`: 2 errores, 0 advertencias; no-unused-vars.
- `src/componentesCompartidos/ModalPortal.jsx`: 1 errores, 0 advertencias; react-hooks/refs.
- `src/componentesDueñoGarage/tarjeta_garage_dueño.jsx`: 3 errores, 0 advertencias; no-unused-vars.
- `src/componentesEmpleado/formulario_detalles_vehiculo.jsx`: 2 errores, 0 advertencias; no-unused-vars.
- `src/componentesEmpleado/modal_editar_reserva.jsx`: 0 errores, 2 advertencias; react-hooks/exhaustive-deps.
- `src/componentesLanding/landing/BentoGrid.jsx`: 1 errores, 0 advertencias; no-unused-vars.
- `src/componentesShared/ToastUndo.jsx`: 0 errores, 1 advertencias; react-hooks/exhaustive-deps.
- `src/componentesSuperadmin/superadmin_dashboard_boton.jsx`: 3 errores, 0 advertencias; no-unused-vars, react-hooks/refs.
- `src/pages/PaymentStatus.jsx`: 4 errores, 0 advertencias; no-empty, react-hooks/set-state-in-effect.
- `src/vistasAdmin/admin_dashboard.jsx`: 1 errores, 0 advertencias; no-unused-vars.
- `src/vistasAdmin/admin_pagos.jsx`: 3 errores, 1 advertencias; no-empty, react-hooks/exhaustive-deps, react-hooks/purity.
- `src/vistasAdmin/perfil_admin.jsx`: 3 errores, 0 advertencias; no-empty, no-unused-vars, react-hooks/set-state-in-effect.
- `src/vistasEmpleados/empleados_dashboard.jsx`: 11 errores, 1 advertencias; no-unused-vars, react-hooks/exhaustive-deps.
- `src/vistasEmpleados/historial_reserva.jsx`: 2 errores, 0 advertencias; no-unused-vars, react-hooks/set-state-in-effect.
- `src/vistasEmpleados/perfil_empleado.jsx`: 5 errores, 0 advertencias; no-empty, no-unused-vars, react-hooks/set-state-in-effect.
- `src/vistasSuperadmin/gestion_usuarios.jsx`: 12 errores, 0 advertencias; no-unused-vars, react-hooks/set-state-in-effect.
- `src/vistasSuperadmin/superadmin_pagos_test.jsx`: 6 errores, 1 advertencias; no-empty, react-hooks/exhaustive-deps, react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect.

# SEG-04: aislamiento de escrituras

## Causa y correccion

Base revisada: `fe5de52094700c810baca926d989181f27bf79ba`. El arbol estaba
limpio al comenzar. Las correcciones de SEG-01, SEG-02 y SEG-03 se conservan.

- **Sedes:** el controller omitia el actor en alta/edicion; el servicio ignoraba
  el actor en la baja y el SQL escribia solo por ID. La empresa venia del body.
  Ahora se resuelve un alcance desde `req.usuario`, se bloquea la sede dentro
  de la transaccion y se conserva el filtro de empresa y sede en cada escritura.
  El destino se valida contra empresas existentes y no borradas, con `FOR SHARE`.
  El PUT usa una lista fija de campos presentes: omitir un campo no escribe NULL.
- **Usuarios:** estado/baja leian sin contexto y modificaban tokens/auditoria
  sin comprobar pertenencia ni jerarquia. Ahora se bloquea el usuario autorizado,
  se comprueba la jerarquia y las reservas, y se escriben estado/baja, version de
  tokens, auditoria y revocacion de sesiones usando el mismo cliente SQL.
  La creacion normal de reservas tambien bloquea al usuario, evitando que se
  intercale entre la comprobacion de reservas y la baja.
- **Reservas:** la lectura y las validaciones ocurrian fuera de la transaccion;
  cualquier admin podia cancelar/liberar recursos ajenos. Ahora se bloquean
  titular y reserva, se autoriza en la transaccion y se repite el alcance en el
  UPDATE. El alcance de empresa/sede se resuelve desde el titular persistido,
  como en las consultas existentes. Se conservan la ventana de cancelacion,
  las restricciones de ingreso y el estado pendiente para liberar retenciones.
  No se modifican ocupacion, capacidad ni los snapshots de pagador/tarifa/importe.

Se detecto ademas un camino alternativo del mismo problema: el PUT general de
usuarios escribia `activo` y `token_version` desde un objeto previamente leido.
Podia eludir PATCH estado o restaurar un estado anterior a una desactivacion.
El PUT ahora rechaza cambios de estado con 400 y dirige al PATCH especifico;
acepta formularios que reenvian el estado sin cambios. Su SQL conserva el estado
y la version de tokens vigentes, incluso ante una edicion atrasada.

## Permisos y contrato

`writeAuthorization.js` decide permisos; `writeTenantFilter.js` traduce el alcance
a SQL parametrizado. `getTenantCondition` y sus consumidores existentes no cambian.

| Actor | Alcance permitido |
| --- | --- |
| Administrador (1) | Solo su empresa; si tiene sede, deben coincidir empresa **y** sede |
| Empleado (2) | Solo reservas propias para cancelar/liberar; DELETE mantiene su restriccion a admin/superadmin |
| Superadmin (4) | Global, sujeto a las mismas validaciones de negocio |
| Actor ausente / rol no permitido | 401 / 403; nunca se obtiene alcance global por omision |

Un admin no puede gestionar el estado/baja de un superadmin aunque ese usuario
tenga empresa/sede coincidentes. Fuera de alcance o inexistente devuelve 404;
jerarquia/rol prohibidos, 403. Las validaciones de negocio mantienen 400/409.
Los errores SQL de los caminos modificados se propagan como errores de servidor.

En altas de sedes, un admin general puede omitir empresa y se usa su sesion;
una empresa distinta se rechaza con 403. Un admin de sede no puede crear sedes.
El superadmin debe indicar una empresa valida. Solo el superadmin puede transferir
una sede a otra empresa. Los campos de identidad/auditoria del body no amplian
el alcance. El middleware existente valida la identidad y recarga rol/empresa/sede.

Endpoints con comportamiento modificado:

- `POST /api/sede`, `PUT /api/sede/:id`, `DELETE /api/sede/:id`.
- `PATCH /api/usuario/:id/estado`, `DELETE /api/usuario/:id`.
- `PUT /api/usuario/:id`: impide cambios de estado por el CRUD general y conserva tokens.
- `POST /api/reserva/:id/cancel`, `POST /api/reserva/:id/liberar-retencion`,
  `DELETE /api/reserva/:id` (alias de cancelacion).

Se revisaron los llamados internos antes de modificar las firmas: las escrituras
afectadas son invocadas por estos controllers/servicios. No hay un llamado interno
legitimo que necesite omitir el actor. La expiracion automatica de retenciones usa
su metodo interno separado y se conserva.

No hay migraciones ni cambios de frontend. Se verifico el contrato del frontend
en [API_Usuario.js](https://github.com/SmartLot-Org/SmartLot/blob/main/src/servicies/API_Usuario.js):
ya utiliza PATCH `/:id/estado` para los cambios de estado.

## Evidencia y ejecucion

Antes de corregir, se agregaron y ejecutaron tres reproducciones HTTP con SQL real:

| Reproduccion | Antes | Despues |
| --- | --- | --- |
| Admin A crea sede en B | 201, sede creada | 403, sin cambios |
| Admin A desactiva usuario B | 200, activo=false, token_version 7 a 8, auditoria modificada | 404, sin cambios |
| Admin A cancela reserva B | 200, reserva borrada logicamente | 404, sin cambios |

Tambien se reprodujeron antes de corregirlos los dos caminos alternativos:
PUT cambiaba estado con 200 sin incrementar token_version; una edicion de perfil
atrasada restauraba `activo=true` despues de una baja. Ambas pruebas fallaron;
ahora pasan, junto con el PUT permitido que conserva el estado.

La nueva suite ejecuta los controllers HTTP, middleware JWT, servicios y SQL de
repositorios reales sobre PostgreSQL embebido PGlite aislado, sin mocks de permisos.
Fixtures: dos empresas, tres sedes, admins generales/de sede, empleados de la misma
y de distintas sedes, roles de garage y superadmin. Se comparan snapshots completos
de recursos, sesiones, tokens, auditoria, retenciones y ocupacion en peticiones
denegadas. Triggers SQL provocan fallos despues de modificar un usuario y al escribir
sedes/reservas: se comprueba rollback y propagacion del error. Tambien se prueban
directamente los filtros SQL de escritura y los llamados sin actor.

Desde `SmartLot_API/`:

```sh
node --experimental-test-module-mocks --test test/tenant-writes-sql.integration.test.js test/usuario-repository.test.js test/reserva-repository.test.js test/reserva-qr.test.js test/reservation-policy.test.js test/reservation-limit.integration.test.js test/solicitud-registro.test.js test/garagista-regla.test.js
node --experimental-test-module-mocks --test test/enterprise-payment-sql.integration.test.js test/enterprise-payment-attempts-migration.integration.test.js test/mp-service.test.js test/mp-controller.test.js test/manual-refund-route.test.js test/payment-read-access.test.js test/payment-read-sql.integration.test.js test/cuentas-corrientes.test.js
npm run check:syntax
npm run check:routes
git diff --check
```

En PowerShell se uso `npm.cmd`. Resultados finales:

- SEG-04 y regresiones usuarios/reservas: 152 aprobadas (78 nuevas), 0 fallos,
  1 omitida. La omitida requiere `TEST_RESERVATION_DATABASE_URL` y un servidor
  PostgreSQL local; no estan disponibles. No se cuenta como aprobada.
- Suite dirigida SEG-03: 152 aprobadas, 0 fallos, 0 omitidas.
- Sintaxis, rutas y diff: aprobados.

Durante la primera ejecucion de una regresion existente de garagistas se detecto
un intento de correo bloqueado por el sandbox. Se agrego el mock del servicio de
correo a esa prueba y se repitio la suite sin envios. Las pruebas nuevas tambien
simulan correo; los pagos usan el proveedor simulado de la suite existente.
No se utiliza produccion ni pagos reales.

## Limites

PGlite valida el SQL, transacciones y comportamiento HTTP, pero no sustituye una
prueba de contencion entre varias conexiones de un servidor PostgreSQL. La suite
local de servidor queda explicitamente omitida. No se ejecutaron integraciones
con proveedores reales ni comprobaciones de frontend, que no fue modificado.
No se reparan datos historicos ya alterados y no se amplian otros CRUD/hallazgos.

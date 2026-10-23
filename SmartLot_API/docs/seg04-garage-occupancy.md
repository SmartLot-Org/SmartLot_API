# Autorizacion de ingresos y egresos sin reserva

Base revisada: `e6ef17da55629d9985da47e9ada622c71cfd9580`.
El arbol estaba limpio al comenzar. Se conservan las correcciones anteriores.

## Causa y alcance

`POST /api/garage/:id/ingreso-no-reserva` y
`POST /api/garage/:id/egreso-no-reserva` comprobaban el rol, pero el controller
no transmitia `req.usuario`. El servicio leia sin actor y el repositorio escribia
solo por ID. Ademas, la lectura de capacidad y el incremento estaban separados,
por lo que varios ingresos podian superar el limite observado inicialmente.

No se reutiliza `assertGarageControl` ni `getByIdAsync`: el permiso de lectura
comercial incluye garages externos con trato y no autoriza operar su ocupacion.
No se modifican pagos, tratos, navegacion, el flujo QR ni sus metodos de ocupacion
de reservas. No hay migraciones ni cambios de frontend.

## Politica final

`garageOccupancyAuthorization.js` decide el alcance exclusivamente a partir del
actor validado por el middleware. El repositorio traduce ese alcance a SQL.

| Actor | Permiso de operacion |
| --- | --- |
| Garagista (3) | Asignacion vigente en `usuario_garage` para ese garage |
| Admin general (1) | Garage propio por `id_sede_propia`, cuya sede pertenece a su empresa |
| Admin de sede (1) | Ademas, la sede propietaria debe coincidir con su sede |
| Superadmin (4) | Global, conservando limites de capacidad y exclusiones por borrado |
| Empleado, dueño y otros roles | 403, incluso si tienen asociacion con el garage |
| Actor ausente | 401; no existe fallback a permisos globales |

Un trato comercial o los campos `id_garage`, `id_garages`, rol, empresa o usuario
en el body/JWT no conceden operacion. El middleware recarga los permisos desde SQL.
Las escrituras verifican nuevamente la identidad, rol y contexto persistidos.
Garage inexistente, borrado o fuera de alcance devuelve 404. ID invalido devuelve
400. Capacidad insuficiente conserva 400. Una sesion cuyo rol/contexto cambio
desde la validacion del middleware se rechaza con 401 y debe autenticarse otra vez.
Errores SQL reales se propagan como 500, sin convertirse en exito o falso 404.

## Atomicidad y contadores

El servicio usa un solo cliente SQL desde BEGIN hasta COMMIT/ROLLBACK:

1. Bloquea con `FOR SHARE` al actor y su rol, revalidando estado y contexto.
2. Para garagistas, bloquea con `FOR SHARE` la asignacion exacta. Eso impide
   eliminarla o modificarla entre autorizar y escribir.
3. Bloquea el garage autorizado con `FOR UPDATE`. Para admins, tambien bloquea
   y revalida con `FOR SHARE` la sede propietaria. El garage bloqueado no puede
   cambiar de propietario y la sede bloqueada no puede cambiar de empresa/borrado
   antes de que termine la operacion.
4. Comprueba la capacidad sobre la fila bloqueada y actualiza con aritmetica SQL.
   El UPDATE repite el alcance, la exclusion por borrado y los limites de cupo
   sin reserva y capacidad total. No depende de una lectura antigua ni del permiso
   de lectura comercial.

Se conserva el fallback de `capacidad_para_no_reservas=NULL` a capacidad total y
el de ocupaciones NULL a cero. El ingreso no crea valores negativos. El egreso
usa `GREATEST(0, contador-1)`: **cuando ya esta en cero responde 200 y mantiene
cero**, como antes. Los contadores de reservas y los demas campos no se modifican.

Se revisaron todos los consumidores: estos dos controllers y servicios son los
unicos callers de los metodos modificados. No hay un flujo interno legitimo que
necesite operar sin actor. Los metodos del repositorio sin alcance valido no
actualizan filas; un alcance global incompleto tampoco habilita escritura.

## Reproducciones y pruebas

Primero se agregaron y ejecutaron las dos reproducciones HTTP con middleware JWT,
servicios y SQL reales en PGlite. Garagista 5 asignado solo a garage 1:

| Operacion sobre garage 2 ajeno | Antes | Despues |
| --- | --- | --- |
| Ingreso, contador inicial 0 | 200, contador 1 | 404, contador 0 |
| Egreso, contador inicial 1 | 200, contador 0 | 404, contador 1 |

Ambas pruebas fallaron antes de corregir. Despues se comparan snapshots completos
de garages, usuarios, sedes, asignaciones y tratos para verificar ausencia de efectos.

La nueva suite tiene 60 pruebas. Incluye asignaciones multiples, revocacion,
garages propios de dos empresas y varias sedes, lectura por trato sin permiso de
operacion, roles prohibidos, payloads/claims manipulados, borrados, limites, NULL,
egreso en cero, servicios sin actor y filtros SQL invocados directamente.

Promesas controladas retienen requests despues del middleware y antes del BEGIN;
se confirma una revocacion/cambio de propiedad/contexto y se verifica el rechazo
al adquirir los bloqueos. No se usan sleeps. Solicitudes HTTP simultaneas y UPDATE
SQL directos comprueban los limites y la ausencia de contadores negativos.
Triggers SQL modifican otro garage y luego fallan para demostrar rollback completo;
tambien se verifica propagacion de errores en la lectura.

Se aislaron imports de conexion/correo en cuatro regresiones existentes
(`garage-propio`, `garage-and-trato`, `reserva-qr`, `solicitud-registro`). En la
primera ejecucion se detectaron intentos de conexion de los pools al importar
modulos, que fallaron con ECONNREFUSED. La verificacion final se repitio con todos
esos imports simulados, sin conexiones externas ni correos/pagos reales. Las pruebas
nuevas ejecutan el SQL real en PGlite, sin simular decisiones de autorizacion.

Desde `SmartLot_API/`:

```sh
node --experimental-test-module-mocks --test test/garage-occupancy-sql.integration.test.js test/garage-propio.test.js test/garage-responsables.test.js test/garage-sin-sede.test.js test/garage-and-trato.test.js test/tenant-writes-sql.integration.test.js test/usuario-repository.test.js test/reserva-repository.test.js test/reserva-qr.test.js test/reservation-policy.test.js test/reservation-limit.integration.test.js test/solicitud-registro.test.js test/garagista-regla.test.js test/enterprise-payment-sql.integration.test.js test/enterprise-payment-attempts-migration.integration.test.js test/mp-service.test.js test/mp-controller.test.js test/manual-refund-route.test.js test/payment-read-access.test.js test/payment-read-sql.integration.test.js test/cuentas-corrientes.test.js
npm run check:syntax
npm run check:routes
git diff --check
```

En PowerShell se uso `npm.cmd`. Resultados:

- 60 pruebas nuevas aprobadas.
- 32 regresiones existentes de garages aprobadas.
- 189 pruebas de SEG-04/usuarios/reservas aprobadas.
- 152 pruebas dirigidas de SEG-03 aprobadas.
- Total: **433 aprobadas, 0 fallos, 1 omitida**.
- Sintaxis, rutas y diff aprobados.

La omitida es `reservation-limit.integration.test.js`: requiere un servidor
PostgreSQL local y `TEST_RESERVATION_DATABASE_URL`, no configurado. No se cuenta
como aprobada. No se ejecuta `mp-integration.test.js`, que necesita servicios y
credenciales reales; se conserva la suite documentada con proveedor simulado.

## Limites

PGlite ejecuta SQL PostgreSQL y transacciones, pero utiliza una sola conexion.
Las pruebas simultaneas no sustituyen una prueba de contencion de bloqueos entre
conexiones de un servidor PostgreSQL. No se reparan datos historicos ni se cambian
otros caminos de escritura de contadores. No se ejecutan comprobaciones de frontend,
que no fue modificado.

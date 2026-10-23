# SEG-10B, primera parte: solicitud pública de empresas

## Alcance y contrato

Solo cambia `POST /api/solicitud-registro`. Los registros públicos de empleado y
dueño de garage siguen pendientes de revisión separada; esta entrega no resuelve
toda la enumeración de registros. No hay migraciones ni cambios de producción.

Antes se distinguían creación (201 con datos de solicitud), pendiente (409) y
usuario registrado (409 con email en el mensaje). Después de validar formato,
los tres resultados responden exactamente 202 y:

```json
{"message":"Recibimos tu solicitud. Si corresponde procesarla, te contactaremos por correo. Si ya tenés una cuenta, podés iniciar sesión o recuperar tu contraseña."}
```

No se incluyen ID, usuario, solicitud, hashes, flags ni estado interno. Se
conservan 400 de formato, 429 del limitador y 500 de fallos internos reales. No
se crean sesiones ni se emiten/eliminan cookies, incluso ante un error SQL. El
controlador usa la opción interna de preservar cookies incorporada en SEG-10A,
solo para el error interno de esta ruta pública; no cambia endpoints protegidos.

## Persistencia, concurrencia y trabajo

Se conserva la normalización de email, validaciones y política de contraseña.
Toda entrada válida realiza una sola operación bcrypt con BCRYPT_ROUNDS (12 por
defecto) y ambas consultas previas. La creación utiliza ese mismo hash, sin
volver a hashearlo. Un usuario existente o solicitud pendiente no se modifica.
El lookup de usuario usa throwOnError, ya disponible, para distinguir una
ausencia de un fallo SQL sin cambiar otros consumidores del repositorio.

La nueva solicitud se guarda pendiente, con campos de estado/asociación
controlados por el servidor. El repositorio devuelve null solo ante
`code === '23505'` y
`constraint === 'uq_solicitudes_registro_email_pendiente'`. Es la colisión
esperada si otra petición ganó la carrera; los demás errores se propagan.
No se comparan textos de mensajes ni se trata todo 23505 como duplicado.
Solo la creación efectiva programa la notificación. Listado, consulta,
aprobación y rechazo conservan permisos, respuesta sanitizada de SEG-07 y uso
del hash original al crear el administrador.

## Correo y límites temporales

La notificación se programa mediante setImmediate en el mismo proceso después
de persistir. La respuesta HTTP no espera la consulta a superadmins ni la entrega
de correo. Se conserva un intento por destinatario activo, con manejo
best-effort existente de los errores, más un catch de fallos inesperados de la
tarea. Los duplicados no programan nuevas notificaciones.

No es una cola durable: una caída o reinicio antes de terminar el envío puede
perder la notificación. No hay reintento durable ni garantía de entrega, de
orden o de entrega exactamente una vez por parte del proveedor. La solicitud
queda persistida y disponible en la bandeja protegida aunque se pierda el aviso;
repetir el registro no reenvía ese aviso. No se incorporó infraestructura general
de colas ni promesas de correo ya enviado en la UI.

Hash y consultas previas comunes reducen diferencias evidentes; desacoplar el
correo elimina la espera exclusiva por su entrega en el caso nuevo. No se
garantizan tiempos idénticos: escritura, contención, caché, consultas, carga y
red todavía pueden diferir. No se usan sleeps ni demoras aleatorias.

## Evidencia y pruebas

Se agregó primero `test/solicitud-registro-public-sql.test.js`, usando router,
servicio, repositorios y manejador de errores reales, bcrypt real, PGlite local
y correo simulado. La regresión inicial observó `[201, 409, 409]` frente a
`[202, 202, 202]`. Después pasan los diez casos nuevos.

La concurrencia fuerza con promesas que ambas lecturas vean ausencia antes de
insertar; usa la migración y el índice reales. Quedan una fila, una colisión
23505 con el constraint esperado y una notificación. PGlite ejecuta el motor
PostgreSQL aislado y serializa sus operaciones; esta prueba reproduce la carrera
de prelectura/inserción, no constituye una prueba con varias conexiones a un
servidor PostgreSQL externo.

Para correo lento se bloquea su promesa, se comprueba que las respuestas HTTP
terminan antes de liberarla y después se provoca un fallo controlado. No hay
aserciones de milisegundos. También se comprueban preservación de filas y hash,
errores SQL en consultas/inserción, otros constraints, tipos de error distintos,
permisos, validación y 429. Las pruebas SEG-07 se adaptaron al acuse público sin
perder cobertura de sanitización de objetos protegidos y hash de aprobación.

Comandos backend (182/182 pruebas aprobadas):

```sh
node --experimental-test-module-mocks --test test/solicitud-registro.test.js test/solicitud-registro-http.test.js test/solicitud-registro-public-sql.test.js test/password-login-sql.integration.test.js test/google-auth-http.test.js test/logout-sql.integration.test.js test/recovery-sql.integration.test.js test/usuario-repository.test.js
npm run check:syntax
npm run check:routes
git diff --check
```

No se ejecuta la suite global backend: incluye integración externa de pagos.
No se usaron servicios reales, producción ni credenciales reales.

Frontend: RegisterEmpresaForm conserva diseño, navegación, validaciones y
tratamiento de 2xx/errores. Cambia únicamente el texto de confirmación y elimina
el estado de email mostrado por la promesa anterior. Se verificó el contrato
de fuente junto a la cobertura existente, sin cambiar el cliente HTTP.
Comandos: `npm test` (121/121), lint dirigido a los dos archivos modificados,
`npm run build` y `git diff --check`. La deuda de lint global preexistente
documentada por AGENTS.md no se aborda ni se vuelve a ejecutar el lint global;
el build mantiene advertencias por chunks mayores a 500 kB. La instalación
desde lockfile mostró avisos de dependencias transitivas deprecadas; no se
cambiaron dependencias ni lockfiles.

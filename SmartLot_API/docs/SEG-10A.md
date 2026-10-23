# SEG-10A: enumeración desde el login con contraseña

## Corrección y alcance

`POST /api/usuario/login` diferenciaba una cuenta inexistente (401) de una
desactivada (403) antes de comparar la contraseña. La ausencia de cuenta también
evitaba todo trabajo bcrypt. Ahora los fallos de credenciales con formato válido
comparten exactamente el estado 401 y el cuerpo del manejador real:

```json
{"error":true,"message":"Credenciales incorrectas.","statusCode":401}
```

Aplica a inexistente, contraseña incorrecta, desactivada (incluso con contraseña
correcta), borrada y cuenta sin hash utilizable. La consulta conserva su filtro
de cuentas borradas y el criterio previo de desactivación (`activo === false`).
La decisión se toma después de una comparación bcrypt real. No se cambian
contraseñas, hashes, roles, empresa, sede ni la política de contraseñas.

Un hash señuelo se prepara una vez por proceso con contraseña aleatoria y el
`BCRYPT_ROUNDS` ya configurado (12 por defecto). Se reutiliza cuando falta el
usuario o un hash bcrypt utilizable. Los hashes existentes con formato soportado
por bcrypt (`$2a$`/`$2b$`, costo 04–31 y longitud correcta) siguen comparándose
directamente, también si la cuenta está desactivada. La condición de ingreso
exige usuario y hash real: acertar el señuelo nunca autoriza una sesión.

Esto reduce una diferencia evidente de procesamiento, **no prueba tiempos
idénticos**. Persisten diferencias de consulta, índices/caché, costos de hashes
históricos, arranque y preparación inicial, carga y red. No se agregan sleeps,
demoras aleatorias ni mediciones temporales frágiles como prueba de seguridad.

## Errores internos y preservación de sesiones

El repositorio antes devolvía null ante fallos SQL al buscar email y al crear
sesiones. El login usa ahora una opción interna `throwOnError` en esas dos
operaciones; el comportamiento predeterminado de los demás consumidores no
cambia. Un error SQL permanece como error interno, no como credenciales
incorrectas. Un resultado null al guardar la sesión tampoco produce éxito.

Los errores internos del login se envían sanitizados al manejador existente,
sin datos de SQL, credenciales ni tokens. Una marca interna, exclusiva de ese
camino del login, evita que el manejador borre las cookies de la sesión previa
cuando responde 500. La respuesta pública conserva su formato habitual:

```json
{"error":true,"message":"Error interno del servidor","statusCode":500}
```

Los intentos rechazados no crean ni revocan sesiones, no emiten JWT de respuesta
y no establecen ni eliminan cookies. No se cambian los 403 de endpoints
protegidos, los 400 de formato ni los 429 del limitador. El login correcto
mantiene respuesta, claims, cookies y rotación mediante refresh.

## Pruebas

Se agregó primero `test/password-login-sql.integration.test.js`: router,
servicio, repositorio, bcrypt y manejador de errores reales, con PostgreSQL
aislado mediante PGlite. El pool se sustituye por el motor local; no se simula
`loginAsync()`. Las observaciones de bcrypt delegan en su implementación real.
Se usan secretos efímeros; correo y servicios externos están bloqueados.

Antes del arreglo fallaron 5/7 pruebas: se reprodujo el 403 desactivado, faltaba
comparación señuelo, la lectura SQL fallida respondía 401 y una inserción fallida
de sesión respondía 200. Después pasan las 11 pruebas nuevas, incluidos costo y
reutilización del señuelo, coincidencia con su contraseña sin acceso, hash real
en desactivados, fallo/null de persistencia, conservación de filas/cookies,
login y refresh válidos, formato, rate limit y autorización protegida.
Durante la ampliación se corrigió el fixture de roles para incluir su columna
Borrado, requerida por el middleware real de autorización.

Comandos de validación:

```sh
node --experimental-test-module-mocks --test test/password-login-sql.integration.test.js test/google-auth-http.test.js test/logout-sql.integration.test.js test/recovery-sql.integration.test.js test/usuario-repository.test.js
npm run check:syntax
npm run check:routes
git diff --check
```

El conjunto aislado pasa 142/142 pruebas. Incluye Google, login/refresh, logout,
recuperación y las comprobaciones previas del repositorio. No se ejecuta
`npm test` global porque incluye integración externa de pagos; tampoco se usan
servicios o credenciales reales.

Se revisó `LoginForm.jsx`: ya muestra `err.response.data.message` y sigue siendo
compatible. No se modifica frontend ni se ejecutan sus pruebas/lint/build.
No requiere migraciones ni configuración nueva. Enumeración en registros y
plantillas HTML quedan fuera de esta corrección.

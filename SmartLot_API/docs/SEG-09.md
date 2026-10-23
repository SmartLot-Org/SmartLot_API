# SEG-09: identidad Google y email en el callback

## Causa y corrección

`POST /api/auth/google/callback` verificaba el token con Supabase, pero aceptaba
cualquier usuario devuelto sin comprobar su identidad Google ni la confirmación
del email. También permitía seleccionar la cuenta local usando
`user_metadata.email`, un dato editable. Ahora un helper puro separado valida el
usuario autenticado antes de buscar la cuenta local. No se decodifica el JWT de
Supabase para establecer identidad: se conserva `supabaseAdmin.auth.getUser()`
contra el proyecto configurado.

Se inspeccionaron las versiones instaladas `@supabase/supabase-js` y
`@supabase/auth-js`, ambas 2.105.3, incluidos `User` y `UserIdentity` de
`node_modules/@supabase/auth-js/src/lib/types.ts`. No se actualizaron paquetes.
Se revisó el changelog actual: los avisos de TLS y URL self-hosted no cambian
este contrato ni requieren cambios para esta corrección.

Referencias:

- [Usuarios](https://supabase.com/docs/guides/auth/users): `email_confirmed_at`,
  `is_anonymous`, múltiples identidades y significado de `app_metadata.provider`.
- [Identidades](https://supabase.com/docs/guides/auth/identities): asociación por
  `user_id` y datos de proveedor en `identity_data`.
- [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
  y [getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
- [Modelo oficial de identidad](https://github.com/supabase/auth/blob/master/internal/models/identity.go):
  el JSON conserva `identity_id` como UUID de identidad e `id` como ID del
  proveedor; `identity_data.sub` origina ese ID. La verificación del email usa
  exactamente el booleano `identity_data.email_verified`.
- [Proveedor Google](https://github.com/supabase/auth/blob/master/internal/api/provider/google.go):
  normaliza la verificación de Google al campo de identidad `email_verified`.

## Reglas de aceptación

1. `access_token` debe ser un string no vacío tras comprobar espacios. Se envía
   sin alterar a `getUser()`; no se usan campos del body para acreditar identidad.
2. La respuesta debe contener un usuario objeto con `id` UUID. Se rechaza
   `is_anonymous: true` y cualquier valor distinto de false cuando el campo está
   presente. Se admite su omisión porque es opcional en el SDK instalado.
3. El email sale únicamente de `user.email`, que debe ser string válido según
   el validador de la aplicación. Se recortan espacios externos y se convierte
   a minúsculas; no se quitan puntos, sufijos `+` ni se equiparan dominios/alias.
4. `email_confirmed_at` debe ser un timestamp RFC3339 válido, con zona y fecha
   de calendario válida. `confirmed_at` y `phone_confirmed_at` no sustituyen la
   confirmación del email.
5. `identities` debe ser un array no vacío de objetos. Cada identidad debe tener
   `provider` e `id` strings no vacíos, `identity_id` UUID y `user_id` idéntico al
   usuario autenticado. Debe existir al menos una identidad `provider: "google"`.
6. Cada identidad Google debe tener `identity_data` objeto, `sub === identity.id`,
   `email_verified === true` (no strings ni valores truthy) y email normalizado
   idéntico al principal. Si vienen los campos adicionales `identity.email` o
   `identity.provider_id`, también deben coincidir. Se rechazan identidades
   Google adicionales contradictorias o mal formadas.
7. Solo entonces se busca la cuenta local por el email validado. Debe existir,
   tener `activo === true` y no estar borrada. El repositorio ya filtra Borrado;
   el callback también lo comprueba. Roles, empresa, sede y token_version salen
   exclusivamente de la fila local.

`user_metadata` no acredita nada ni elige la cuenta. Tampoco se exige que
`app_metadata.provider` sea Google: indica el primer proveedor, y una cuenta
inicialmente email con Google correctamente vinculado sigue siendo válida.
Ni ese campo ni el array `providers` prueban por sí solos una identidad Google.
Esta política acredita una asociación Google verificada, **no demuestra que la
sesión concreta se haya iniciado mediante Google**. No se rediseña OAuth ni se
crean/vinculan automáticamente cuentas locales.

## Respuestas y sesiones

Todos los rechazos del callback usan el mensaje público genérico
`No se pudo iniciar sesión con Google.`:

- 400: token ausente, vacío o de tipo inválido; no se llama a Supabase.
- 401: token rechazado/expirado, identidad inválida o cuenta local inexistente.
- 403: cuenta local inactiva o borrada.
- 503: cliente Supabase no disponible, excepción de comunicación o error 5xx
  del proveedor.
- 500: error de configuración JWT, persistencia de sesión fallida/null u otro
  error interno. No se propagan mensajes internos del proveedor o repositorio.

El callback no registra tokens ni respuestas del proveedor. Los rechazos no
escriben cookies ni borran sesiones previas. Los JWT se firman antes de insertar
la sesión y solo se entregan después de obtener un ID de sesión válido.
Se conservan respuesta 200, usuario sin contraseña, claims locales, cookies
HttpOnly/SameSite=Lax (Secure en producción), expiraciones y path del refresh.

## Regresiones y comandos

Se agregó primero `test/google-auth-http.test.js` con routers, helper, JWT y
servicio de refresh reales. Solo se simulan Supabase y persistencia; el correo y
la base externos están bloqueados. Se usan secretos efímeros y datos de prueba.
La primera corrida falló 46 de 48 casos. Las tres regresiones principales
obtuvieron incorrectamente 200: identidad solo email, email no confirmado y
email solo en metadata. El control válido y Google vinculado con proveedor
inicial email ya pasaban.

Después de la corrección y de ampliar los casos mal formados/configuración,
pasan 57 pruebas nuevas y 131 en el conjunto aislado:

```sh
node --experimental-test-module-mocks --test test/google-auth-http.test.js test/logout-sql.integration.test.js test/recovery-sql.integration.test.js test/usuario-repository.test.js
npm run check:syntax
npm run check:routes
git diff --check
```

Los casos comprueban búsquedas y escrituras, ausencia de JWT/cookies, conservación
de sesiones previas, verificación de identidad/email, varios proveedores,
normalización sin equivalencia de alias, fallos/null de sesión, configuración
JWT ausente y rotación efectiva mediante el endpoint real de refresh.
Las suites SQL anteriores de logout/login y recuperación usan PGlite local.

No se ejecutan suites conectadas a servicios externos ni el `npm test` global
que incluye integración real de pagos. No hay pruebas de OAuth contra Google o
Supabase reales. No se modificó frontend: `AuthCallback.jsx` conserva el envío
de `access_token`, consume `usuario` en éxito y maneja el mensaje genérico de
error. Sus pruebas/lint/build se omiten al no haber modificaciones.

## Comprobaciones para el despliegue

No requiere migraciones ni cambios previstos de configuración. Antes de validar
la integración desplegada, comprobar que SUPABASE_URL y la clave del servidor
pertenecen al mismo proyecto esperado; proveedor Google, scopes email/profile,
URLs de retorno y secretos JWT ya están correctamente configurados. No imprimir
sus valores ni copiar tokens/respuestas a logs. Verificar en un entorno de
prueba que las identidades devueltas tienen el esquema documentado y el caso
de Google vinculado. La versión del servicio Auth del proyecto y su
configuración efectiva no se consultaron ni modificaron durante esta tarea.

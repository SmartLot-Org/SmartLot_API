# Migracion a HTTPS — SmartLot API

Guia paso a paso para que **todo quede en `https`** y eliminar `NODE_TLS_REJECT_UNAUTHORIZED=0`.

> Principio: un solo `.env` local. Cambias `NODE_ENV` y (cuando quieras test HTTPS) descomentas 3 lineas. En Render dejas solo las vars prod en el Dashboard.

---

## 1. Que se cambio en el repo

| Archivo | Cambio | Por que |
|---|---|---|
| `SmartLot_API/.env:1` | Reescrito con bloques DEV/PROD comentados + `NODE_ENV` switch. Eliminado `NODE_TLS_REJECT_UNAUTHORIZED=0` | Un solo archivo dev/prod sin bypass TLS |
| `SmartLot_API/.env.example` (nuevo) | Plantilla commiteada con placeholders | `SmartLot_API/.gitignore:2` sigue ignorando `.env` real, pero `!.env.example` si se commitea |
| `SmartLot_API/.gitignore:3` | Agregado `!.env.example` | Permite commitear el ejemplo |
| `SmartLot_API/package.json:15` | `testEmail` ya no usa `NODE_TLS_REJECT_UNAUTHORIZED=0` | Antes: `set NODE_TLS_REJECT_UNAUTHORIZED=0&&node ...` -> ahora `node ...` directo (Mailtrap API ya es HTTPS) |
| `SmartLot_API/scripts/verify-request-insert.cjs:4` | `ssl` condicional `NODE_ENV==='production' ? {rejectUnauthorized:true} : {rejectUnauthorized:false}` | Antes forzaba `false` siempre -> en prod no verificaba cert |
| `SmartLot_API/scripts/diagnose-deal-permissions.cjs:4` | Idem | Idem |
| `SmartLot_API/src/app.js:42-57` | `app.set('trust proxy',1)`, `helmet` con HSTS condicional, redirect `http->https` via `x-forwarded-proto`, `CORS_ORIGIN` default `http://localhost:5173` | Necesario porque TLS termina en Render/Nginx, no en Node. HSTS solo en prod para no bloquear localhost |
| `SmartLot_API/scripts/check-env.cjs:29` | Ya tenia `FORBIDDEN_IN_PROD = ['NODE_TLS_REJECT_UNAUTHORIZED']` | Te avisa si vuelve a aparecer en prod |
| `SmartLot_API/src/database/db.js:9`, `dbClient.js:13` | Sin cambios (ya estaban correctos con ternario prod/dev) | Referencia de patron correcto |

---

## 2. Como usar el `.env` unico

### Desarrollo normal (http, sin tocar nada)

`.env` viene asi por defecto:

```ini
NODE_ENV=development

BACKEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173
# ... bloque PROD comentado
```

Ejecuta:

```powershell
npm run check:env
npm run check:db
npm run app   # o npm run apptest
```

Cookies `secure` quedan en `false`, DB con `rejectUnauthorized:false` -> ok para localhost.

### Test HTTPS local (simula prod sin deployar)

1. Edita `.env`:

```ini
NODE_ENV=production

# Comenta DEV
# BACKEND_URL=http://localhost:3000
# CORS_ORIGIN=http://localhost:5173
# FRONTEND_URL=http://localhost:5173

# Descomenta PROD
BACKEND_URL=https://api.smartlot.ar
FRONTEND_URL=https://smartlot.ar
CORS_ORIGIN=https://smartlot.ar
```

> Si tu prod es Render subdomain, usa `https://smartlot-api.onrender.com` / `https://smartlot.onrender.com`.

2. Verifica sin flag:

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
npm run check:env      # debe dar warning si falta alguna var, pero NO debe mencionar NODE_TLS
npm run check:db       # conecta con rejectUnauthorized:true -> Supabase cert valido, debe OK
npm run check:consumos
npm run testEmail      # ya no necesita el flag, usa Mailtrap API https
npm test               # mp-service.test ya simula ambos casos (isLocalhost)
```

Si `check:db` falla con `SELF_SIGNED_CERT_IN_CHAIN` o `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, es que aun queda `NODE_TLS_REJECT` en el entorno. Busca con:

```powershell
Get-ChildItem Env: | Select-String TLS
```

3. Para volver a dev, reverti los 3 comentarios y `NODE_ENV=development`.

---

## 3. Configuracion en Render (prod real)

**Render hace TLS termination automatico (Let's Encrypt). No tocas codigo, solo vars.**

1. Dashboard -> tu Web Service `smartlot-api` -> Environment -> **borra** `NODE_TLS_REJECT_UNAUTHORIZED` si existe.
2. Confirma/crea:
```
NODE_ENV=production
DATABASE_URL=postgresql://... (pooler supabase)
SUPABASE_URL=https://amhjswdgrbyfvjmogzjw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12
BACKEND_URL=https://api.smartlot.ar
FRONTEND_URL=https://smartlot.ar
CORS_ORIGIN=https://smartlot.ar
PORT=3000
GOOGLE_MAPS_BACKEND_KEY=...
EMAIL_USER=contact@smartlot.ar
EMAIL_PASS=...
MP_ACCESS_TOKEN=APP_USR-...   # token sandbox (unico modo habilitado)
MP_SANDBOX=true               # se deja en true aun en prod; usar false solo con credenciales prod reales
MP_AUTO_RETURN=approved
MP_WEBHOOK_SECRET=...         # del dashboard MP, requerido en prod
```
> `dotenv` no pisa vars ya seteadas por Render, asi que tu `.env` local no interfiere.

3. Dominio custom (si usas `api.smartlot.ar`):
   - Service -> Settings -> Custom Domains -> Add `api.smartlot.ar` -> copia CNAME -> crea registro DNS `CNAME api -> smartlot-api.onrender.com` -> espera cert.

4. Redeploy: Manual Deploy -> Clear build cache & Deploy.

---

## 4. Verificacion post-deploy

```powershell
# 1. HSTS debe estar presente
curl -I https://api.smartlot.ar/api/usuario/me
# busca: strict-transport-security: max-age=31536000; includeSubDomains; preload

# 2. http debe redirigir a https
curl -I http://api.smartlot.ar/api/usuario/me
# 301 -> https://api.smartlot.ar/...

# 3. Login debe setear cookies Secure
curl -i -X POST https://api.smartlot.ar/api/usuario/login -H "Content-Type: application/json" -d '{"email":"...","contraseña":"..."}'
# busca: Set-Cookie: access_token=...; Secure; HttpOnly; SameSite=Lax

# 4. Webhook MP (solo funciona con https publico)
# MP Dashboard -> Webhooks -> https://api.smartlot.ar/api/payments/webhook
# Eventos: payment.created, payment.updated, payment.refunded
# En prod MP_WEBHOOK_SECRET activo: src/services/mpService.js:122 deja de estar en DEV MODE
```

En browser: DevTools -> Application -> Cookies -> `access_token` debe figurar `Secure` + `HttpOnly` + `SameSite=Lax` tras login prod.

---

## 5. Frontend

Si esta en dominio distinto (`app.smartlot.ar` vs `api.smartlot.ar`), `SameSite=Lax` alcanza porque comparten sufijo `smartlot.ar`. Si frontend esta en `netlify.app` / `vercel.app` (origen cruzado distinto), avisame: hay que cambiar a `SameSite=None` + `Secure` + `trust proxy` (ya esta) en `SmartLot_API/src/controllers/usuarioController.js:54` y `AuthController.js:20`.

Actualiza el `.env` del frontend:

```
VITE_API_URL=https://api.smartlot.ar
# o NEXT_PUBLIC_API_URL=...
```

---

## 6. Checklist antes de dar por terminado

- [ ] `grep -r NODE_TLS_REJECT_UNAUTHORIZED` no devuelve nada salvo `check-env.cjs` (FORBIDDEN) y este doc
- [ ] `npm run check:env` en `NODE_ENV=production` no lista `NODE_TLS...` en warnings
- [ ] `npm run check:db` OK en ambos modos (dev con false, prod con true)
- [ ] `curl https://api.smartlot.ar` -> HSTS + cookies Secure
- [ ] MP webhook configurado con `https` y `MP_WEBHOOK_SECRET` seteado
- [ ] Render sin `NODE_TLS_REJECT_UNAUTHORIZED` en Environment

---

## 7. Rollback

Si algo falla al quitar el flag, no vuelvas a poner `NODE_TLS_REJECT_UNAUTHORIZED=0`. En su lugar:

1. Revisa `NODE_ENV` (debe ser `production` en Render, `development` en local).
2. Revisa que `DATABASE_URL` apunte al pooler Supabase `...pooler.supabase.com:5432` (no directo).
3. Corre `npm run pre-deploy` y pega el output para debug.

Refs: `SmartLot_API/src/app.js:42-57`, `SmartLot_API/scripts/check-env.cjs:29`, `SmartLot_API/docs/frontend-mercadopago.md:114`.

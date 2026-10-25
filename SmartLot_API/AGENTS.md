# Agent Guidelines

## Project Structure
- **Node.js + Express** API with ES modules (`"type": "module"`)
- **Supabase** for database (PostgreSQL)
- **JWT** for authentication
- Middleware structure: `src/middlewares/`
- Controllers: `src/controllers/`

## Key Middleware
- `authMiddleware` - JWT verification + user validation
- `rolesMiddleware` - contains `requireRole`, `requireAdmin`, `requireRoleOrSelf`

## Important Middleware: `requireRoleOrSelf`
Allows access if user has one of the specified roles **OR** if requesting their own resource (`req.usuario.id === req.params.id`).

Usage: `requireRoleOrSelf(1, 4)` - allows admins (1), superadmins (4), or the user themselves.

Located at: `src/middlewares/rolesMiddleware.js:44-62`

## Common Usage Pattern
```js
router.patch('/:id/contrasenia', authMiddleware, requireRoleOrSelf(1, 4), handler)
```

## Error handling and API conventions (read `docs/plans-franC/api-errores.md` first)
- Layers: **repository** returns `null`/`[]`/`false` only for "no rows" and lets DB errors propagate (no `try/catch ... return null`); **service** throws domain errors; **controller** validates input and maps `null` → 404; **`errorHandler`** is the only place that builds error responses and maps Postgres codes (`23505`→409, `23502/22P02/23514/22001/22003`→400).
- Throw errors with `throwError(message, status, code?)` / `httpError(...)` from `src/helpers/httpError.js`; status constants in `src/helpers/httpStatus.js`. Never define a local `throwError`/`fail`. No status → 500. Do **not** add `try/catch + next(err)`: Express 5 propagates async rejections.
- A 5xx never clears auth cookies. Only `authMiddleware` (invalid JWT → 401), logout and a 4xx on refresh do.
- Route ids: `router.param('id', idParam())` (`src/helpers/validatorHelper.js`); handlers read `req.params.id` already as a number. Never `parseInt(req.params.id)`.
- `PUT` = full replacement (missing required field → 400); `PATCH` = partial. Do not make a `PUT` partial.
- A `GET` must not write. Actions with side effects are `POST` (e.g. `POST /api/payments/:paymentId/verificar`).
- Provider (Mercado Pago) failures are `502 MP_UPSTREAM_ERROR`; never forward the provider's status.
- New routes: kebab-case, plural, Spanish, ASCII only. Do not rename existing routes (it breaks the frontend).
- UI/API messages are Spanish. Comments explain the *why* only.

## Test Command
```bash
npm test                 # full suite; node:test, ~25 s
npm run test:mp          # Mercado Pago subset
npm run check:syntax && npm run check:routes
npm run routes:inventory -- --write   # regenera el inventario de docs/plans-franC/api.md desde el router real
npm run postman:generate              # regenera src/postman/SmartLot.postman_collection.json
```
- Si agregás, quitás o cambiás roles/rutas, regenerá el inventario y la colección: `test/api-inventario.test.js` falla si `docs/plans-franC/api.md` o Postman quedan desactualizados. Los scripts ESM necesitan `--experimental-test-module-mocks` (los npm scripts ya lo incluyen).
- Behaviour tests use `supertest` + `mock.module('../src/database/db.js', ...)` (see `test/api-errores.test.js`). Do not assert on source text with `readFile` + regex.
- Always mock `../src/services/emailService.js` when importing `src/app.js`: it opens its own real DB pool on import.
- `test/mp-integration.test.js` talks to the real Mercado Pago sandbox and the real DB configured in `.env`.
- Use `--test-timeout=120000` when running the suite from automation: a test awaiting a promise that never resolves blocks forever.

## Work in progress
The "API REST" improvement plan is tracked in the **frontend** repo: `SmartLot/docs/plans-franC/README.md` (start there when resuming). Update it as you work.
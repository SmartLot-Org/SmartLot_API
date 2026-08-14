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
router.patch('/:id/contraseña', authMiddleware, requireRoleOrSelf(1, 4), handler)
```

## Test Command
```bash
npm test
```
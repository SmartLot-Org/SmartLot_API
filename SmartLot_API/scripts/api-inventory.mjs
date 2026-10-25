// Inventario de endpoints leído del router real de Express (no de una lista a mano), para que
// docs/plans-franC/api.md no se desactualice. Quien lo use debe tener simuladas la base y el correo antes
// de llamar a collectRoutes(), porque importar src/app.js los instancia.
import express from 'express';
import * as httpStatus from '../src/helpers/httpStatus.js';

const APP_URL = new URL('../src/app.js', import.meta.url).href;
const AUTH_URL = new URL('../src/middlewares/authMiddleware.js', import.meta.url).href;

export const ROLE_LEGEND = '1 admin · 2 empleado (cliente) · 3 garagista · 4 superadmin · 5 dueño de garage';
const ROLE_IDS = { admin: 1, cliente: 2, empleado: 2, garagista: 3, superadmin: 4, 'dueño_garage': 5 };
const STATUS_BY_NAME = Object.fromEntries(Object.entries(httpStatus));

export const INVENTORY_START = '<!-- INVENTARIO:INICIO (generado por scripts/generate-api-inventory.mjs; no editar a mano) -->';
export const INVENTORY_END = '<!-- INVENTARIO:FIN -->';

// Parte los argumentos de primer nivel de una llamada, respetando strings, plantillas y anidamiento.
function splitArgs(src, start) {
    let depth = 1; let current = ''; const args = []; let quote = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            current += c;
            if (c === '\\') { current += src[++i]; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; current += c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break; }
        if (c === ',' && depth === 1) { args.push(current.trim()); current = ''; continue; }
        current += c;
    }
    if (current.trim()) args.push(current.trim());
    return args;
}

function toStatus(token) {
    if (/^\d{3}$/.test(token)) return Number(token);
    return STATUS_BY_NAME[token] ?? null;
}

// Códigos que el propio handler emite. Los services pueden lanzar otros (ver el flujo de cada módulo).
export function statusesOf(source) {
    const success = new Set(); const errors = new Set(); let dynamic = false;
    for (const m of source.matchAll(/res\.status\(([^)]*)\)/g)) {
        const status = toStatus(m[1].trim());
        if (status === null) dynamic = true;
        else if (status < 400) success.add(status);
        else errors.add(status);
    }
    // Sin un status de éxito explícito, `res.json(...)` responde 200.
    if (!success.size && !dynamic && /res\.(json|send|end)\(/.test(source)) success.add(200);
    for (const m of source.matchAll(/(?<![\w.])(?:throwError|httpError)\(/g)) {
        const status = toStatus(splitArgs(source, m.index + m[0].length)[1] ?? '');
        if (status !== null && status >= 400) errors.add(status);
    }
    return { success: [...success].sort(), errors: [...errors].sort(), dynamic };
}

export function normalizeRoles(roles) {
    const ids = new Set();
    for (const role of roles) {
        const id = typeof role === 'number' ? role : ROLE_IDS[String(role).toLowerCase()];
        ids.add(id ?? String(role));
    }
    return [...ids].sort((a, b) => String(a).localeCompare(String(b), 'es', { numeric: true }));
}

function describeMiddleware(fns, authMiddleware) {
    const info = { auth: false, roles: null, allowsSelf: false, authExceptWebhook: false };
    for (const fn of fns) {
        if (fn === authMiddleware) info.auth = true;
        else if (fn?.requiredRoles) { info.roles = fn.requiredRoles; info.allowsSelf ||= Boolean(fn.allowsSelf); }
        else if (typeof fn === 'function' && !fn.stack && /authMiddleware/.test(String(fn))) {
            // Cierre del montaje de pagos: autentica todo salvo POST /webhook.
            info.auth = true;
            info.authExceptWebhook = /\/webhook/.test(String(fn));
        }
    }
    return info;
}

export async function collectRoutes() {
    const mounts = [];
    const originalUse = express.application.use;
    express.application.use = function patchedUse(path, ...fns) {
        if (typeof path === 'string') mounts.push({ path, fns });
        return originalUse.apply(this, arguments);
    };
    let authMiddleware;
    try {
        ({ default: authMiddleware } = await import(AUTH_URL));
        await import(APP_URL);
    } finally {
        express.application.use = originalUse;
    }

    const routes = [];
    for (const mount of mounts) {
        const router = mount.fns.find((fn) => fn?.stack);
        if (!router) continue;
        const mountInfo = describeMiddleware(mount.fns.filter((fn) => !fn?.stack), authMiddleware);
        for (const layer of router.stack) {
            if (!layer.route) continue;
            const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
            const routeInfo = describeMiddleware(layer.route.stack.map((item) => item.handle), authMiddleware);
            const handlers = layer.route.stack.map((item) => item.handle)
                .filter((fn) => fn !== authMiddleware && !fn?.requiredRoles);
            const source = handlers.map((fn) => String(fn)).join('\n');
            const statuses = statusesOf(source);
            for (const routePath of paths) {
                const fullPath = (mount.path + routePath).replace(/\/$/, '') || '/';
                for (const method of Object.keys(layer.route.methods).filter((key) => layer.route.methods[key])) {
                    const isWebhook = mountInfo.authExceptWebhook && method === 'post' && routePath === '/webhook';
                    const paramNames = [...fullPath.matchAll(/:(\w+)/g)].map((m) => m[1]);
                    routes.push({
                        method: method.toUpperCase(),
                        path: fullPath,
                        mount: mount.path,
                        auth: !isWebhook && (mountInfo.auth || routeInfo.auth),
                        roles: routeInfo.roles ?? mountInfo.roles,
                        allowsSelf: routeInfo.allowsSelf || mountInfo.allowsSelf,
                        paramNames: paramNames.filter((name) => router.params?.[name]?.length),
                        ...statuses,
                    });
                }
            }
        }
    }
    return routes;
}

function formatCodes(route) {
    const ok = route.success.length ? route.success.join('/') : (route.dynamic ? 'según resultado' : '—');
    const errors = new Set(route.errors);
    if (route.auth) errors.add(401);
    if (route.roles && !route.allowsSelf) errors.add(403);
    if (route.roles && route.allowsSelf) errors.add(403);
    if (route.paramNames.length) errors.add(400);
    errors.add(500);
    return { ok, errors: [...errors].sort().join(', ') };
}

function formatAuth(route) {
    if (!route.auth) return 'pública';
    if (!route.roles) return 'sesión';
    return `roles ${normalizeRoles(route.roles).join(', ')}${route.allowsSelf ? ' (o el propio usuario)' : ''}`;
}

export function renderMarkdown(routes) {
    const byMount = new Map();
    for (const route of routes) {
        if (!byMount.has(route.mount)) byMount.set(route.mount, []);
        byMount.get(route.mount).push(route);
    }
    const out = [INVENTORY_START, '', `Roles: ${ROLE_LEGEND}. Total: ${routes.length} endpoints en ${byMount.size} módulos.`, ''];
    for (const [mount, list] of byMount) {
        out.push(`### \`${mount}\``, '', '| Método | Ruta | Acceso | Éxito | Errores (controller + comunes) |', '|---|---|---|---|---|');
        for (const route of list) {
            const codes = formatCodes(route);
            out.push(`| ${route.method} | \`${route.path}\` | ${formatAuth(route)} | ${codes.ok} | ${codes.errors} |`);
        }
        out.push('');
    }
    out.push(INVENTORY_END);
    return out.join('\n');
}

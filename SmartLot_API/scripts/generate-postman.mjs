// Genera src/postman/SmartLot.postman_collection.json desde el inventario real de endpoints
// (scripts/api-inventory.mjs): una carpeta por módulo, más una carpeta con los casos de error
// de las fases 1 a 3 del plan "API REST", con tests de Postman.
//   npm run postman:generate
import { mock } from 'node:test';
import { writeFileSync } from 'node:fs';

mock.module(new URL('../src/database/db.js', import.meta.url).href, {
    defaultExport: { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
});
mock.module(new URL('../src/services/emailService.js', import.meta.url).href, {
    namedExports: { enviarCorreoDesdePlantilla: async () => {}, enviarCorreo: async () => {}, renderPlantilla: async () => '', invalidarCachePlantilla: () => {} },
});

const { collectRoutes, normalizeRoles } = await import('./api-inventory.mjs');

const TARGET = new URL('../src/postman/SmartLot.postman_collection.json', import.meta.url);
// Se conserva el id de la colección original para no duplicarla al reimportarla.
const COLLECTION_ID = '6e2777c1-698d-4f83-9f40-8170c3ab907f';

// Cuerpos de ejemplo por endpoint (path sin el prefijo /api). Lo que no figura va con `{}`.
const BODIES = {
    'POST /usuario/login': { email: '{{email}}', 'contraseña': '{{password}}' },
    'POST /usuario/recuperar-clave': { email: '{{email}}' },
    'POST /usuario/register': { nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', 'contraseña': 'Segura12' },
    'POST /usuario': { id_rol: 2, nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', 'contraseña': 'Segura12!!', id_sede: 1, id_empresa: 1, activo: true },
    'PUT /usuario/:id': { nombre: 'Ana', apellido: 'Pérez' },
    'PATCH /usuario/:id/contrasenia': { 'contraseña': 'Segura12' },
    'PATCH /usuario/:id/estado': { activo: true },
    'PATCH /usuario/:id/limite-reservas': { limiteReservasActivas: 3 },
    'POST /usuario/impersonate': { id: 2 },
    'POST /empresa': { nombre: 'Empresa Demo', descripcion: 'Descripción' },
    'PUT /empresa/:id': { nombre: 'Empresa Demo', descripcion: null },
    'POST /sede': { nombre: 'Sede Centro', id_empresa: 1, ubicacion: 'Av. Siempre Viva 123', descripcion: null },
    'PUT /sede/:id': { nombre: 'Sede Centro', ubicacion: 'Av. Siempre Viva 123' },
    'PATCH /sede/:id': { nombre: 'Sede Centro' },
    'POST /marca': { nombre: 'Fiat' },
    'PUT /marca/:id': { nombre: 'Fiat' },
    'POST /modelo': { nombre: 'Uno', id_marca: 1 },
    'PUT /modelo/:id': { nombre: 'Uno', id_marca: 1 },
    'POST /rol': { tipo_rol: 'auditor' },
    'PUT /rol/:id': { tipo_rol: 'auditor' },
    'POST /vehiculo': { id_usuario: 2, id_modelo: 1, patente: 'AB123CD' },
    'PUT /vehiculo/:id': { patente: 'AB123CD' },
    'POST /garage': { nombre: 'Garage Norte', piso: 0, ubicacion: 'Calle 1', capacidad_reservas: 10, capacidad_para_no_reservas: 5 },
    'POST /garage/propio': { id_sede: 1, capacidad_reservas: 10, capacidad_para_no_reservas: 5 },
    'PUT /garage/:id': { nombre: 'Garage Norte' },
    'POST /garage/:id/dias': { dia: 'Lunes' },
    'POST /reserva/cotizacion': { id_garage: 1, id_vehiculo: 1, fecha_entrada: '2026-11-02T10:00:00', fecha_salida: '2026-11-02T12:00:00', dia: 'Lunes' },
    'POST /reserva': { id_garage: 1, id_vehiculo: 1, fecha_entrada: '2026-11-02T10:00:00', fecha_salida: '2026-11-02T12:00:00', dia: 'Lunes' },
    'PUT /reserva/:id': { dia: 'Martes' },
    'POST /reserva/qr/check-in': { qr: '<token del QR>' },
    'POST /reserva/qr/check-out': { qr: '<token del QR>' },
    'POST /conflicto': { id_usuario: 2, descripcion: 'Descripción del reporte', prioridad: 'Media' },
    'PUT /conflicto/:id': { estado: 'En Proceso' },
    'POST /trato-empresa-garage': { id_sede: 1, id_garage: 1, cantidad_cocheras: 5 },
    'PUT /trato-empresa-garage/:id': { cantidad_cocheras: 6 },
    'PATCH /trato-empresa-garage/:id/modalidad-pago': { modalidadPago: 'empresa' },
    'POST /solicitud-empresa-garage': { id_sede: 1, id_garage: 1, cantidad_cocheras: 5, descripcion: 'Solicitud de trato' },
    'POST /solicitud-registro': { nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', telefono: '1155551234', 'contraseña': 'Segura12!!' },
    'POST /payments/preference': { idReserva: 1 },
    'POST /payments/verificar': { externalReference: '{{externalReference}}', preferenceId: '{{preferenceId}}' },
    'POST /payments/:paymentId/verificar': { externalReference: '{{externalReference}}', preferenceId: '{{preferenceId}}' },
    'POST /payments/:paymentId/refund': { amount: 100, motivo: 'Devolución de prueba' },
    'POST /auth/google/callback': { code: '<código OAuth>' },
};

const PARAM_DEFAULTS = { dia: 'Lunes', codigo: 'bienvenida', paymentId: '{{paymentId}}' };
const urlFor = (path) => path.replace(/:(\w+)/g, (_, name) => PARAM_DEFAULTS[name] ?? `{{${name}}}`);

function buildUrl(path) {
    const raw = `{{url}}${urlFor(path)}`;
    return { raw, host: ['{{url}}'], path: urlFor(path).split('/').filter(Boolean) };
}

function buildRequest({ name, method, path, body, description, auth = true, tests, events }) {
    const request = {
        method,
        header: body === undefined ? [] : [{ key: 'Content-Type', value: 'application/json' }],
        url: buildUrl(path),
        description,
    };
    if (body !== undefined) request.body = { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
    if (!auth) request.auth = { type: 'noauth' };
    const item = { name, request, response: [] };
    const scripts = events ?? (tests ? [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }] : undefined);
    if (scripts) item.event = scripts;
    return item;
}

function describe(route) {
    const access = !route.auth ? 'Pública' : route.roles ? `Roles ${normalizeRoles(route.roles).join(', ')}${route.allowsSelf ? ' (o el propio usuario)' : ''}` : 'Cualquier usuario con sesión';
    return `${access}. Éxito: ${route.success.join('/') || (route.dynamic ? 'según resultado' : '—')}. Ver docs/plans-franC/api.md.`;
}

const routes = await collectRoutes();
const MODULE_NAMES = {
    '/api/usuario': 'Usuario y sesión', '/api/auth': 'Auth (Google)', '/api/empresa': 'Empresa', '/api/sede': 'Sede', '/api/garage': 'Garage',
    '/api/marca': 'Marca', '/api/modelo': 'Modelo', '/api/rol': 'Rol', '/api/vehiculo': 'Vehículo', '/api/reserva': 'Reserva',
    '/api/conflicto': 'Conflicto', '/api/trato-empresa-garage': 'Trato empresa-garage', '/api/solicitud-empresa-garage': 'Solicitud empresa-garage',
    '/api/solicitud-registro': 'Solicitud de registro', '/api/notificacion': 'Notificación', '/api/payments': 'Pagos (Mercado Pago)',
    '/api/email-template': 'Plantillas de email', '/api/cuentas-corrientes': 'Cuentas corrientes',
};
const mountOrder = Object.keys(MODULE_NAMES);

const loginTests = [
    "pm.test('login responde 200', () => pm.response.to.have.status(200));",
    'const body = pm.response.json();',
    "pm.collectionVariables.set('accessToken', body.access_token || '');",
];

const folders = mountOrder.filter((mount) => routes.some((route) => route.mount === mount)).map((mount) => ({
    name: MODULE_NAMES[mount],
    item: routes.filter((route) => route.mount === mount).map((route) => {
        const path = route.path.replace(/^\/api/, '');
        const key = `${route.method} ${path}`;
        const body = ['POST', 'PUT', 'PATCH'].includes(route.method) ? (BODIES[key] ?? {}) : undefined;
        return buildRequest({
            name: key, method: route.method, path, body, description: describe(route), auth: route.auth,
            tests: key === 'POST /usuario/login' ? loginTests : undefined,
        });
    }),
}));

const expectStatus = (status, message) => [
    `pm.test('${status}${message ? ': ' + message : ''}', () => pm.response.to.have.status(${status}));`,
    "pm.test('formato de error estándar', () => { const b = pm.response.json(); pm.expect(b.error).to.eql(true); pm.expect(b.statusCode).to.eql(" + status + "); pm.expect(b.message).to.be.a('string'); });",
];
const errorCase = (name, method, path, body, status, message, extraDescription = '') => buildRequest({
    name: `[${status}] ${name}`, method, path, body, tests: expectStatus(status, message),
    description: `Caso de error del plan "API REST". ${extraDescription}`.trim(),
});

const errorFolder = {
    name: 'Casos de error (Fases 1 a 3)',
    description: 'Cada request debe responder con el status indicado y el formato estándar { error, message, statusCode }. Requieren sesión de superadmin y `{{marcaExistente}}` con el nombre de una marca ya creada.',
    item: [
        errorCase('PUT marca con cuerpo vacío', 'PUT', '/marca/{{id}}', {}, 400, 'el PUT exige nombre (antes 404)'),
        errorCase('PUT modelo sin id_marca', 'PUT', '/modelo/{{id}}', { nombre: 'Uno' }, 400, 'el PUT exige id_marca'),
        errorCase('PUT rol con cuerpo vacío', 'PUT', '/rol/{{id}}', {}, 400, 'el PUT exige tipo_rol'),
        errorCase('PUT empresa sin descripcion', 'PUT', '/empresa/{{id}}', { nombre: 'Demo' }, 400, 'la descripción debe ser texto o null (antes se borraba)'),
        errorCase('PUT sede sin ubicacion', 'PUT', '/sede/{{id}}', { nombre: 'Demo' }, 400, 'el PUT exige ubicacion'),
        errorCase('PATCH sede sin campos', 'PATCH', '/sede/{{id}}', {}, 400, 'el PATCH exige al menos un campo'),
        errorCase('GET marca con id 7abc', 'GET', '/marca/7abc', undefined, 400, 'id inválido (antes pedía la marca 7)'),
        errorCase('GET marca con id 0', 'GET', '/marca/0', undefined, 400, 'id inválido'),
        errorCase('GET marca con id decimal', 'GET', '/marca/1.5', undefined, 400, 'id inválido'),
        errorCase('GET garage con id 1e3', 'GET', '/garage/1e3/dias', undefined, 400, 'id inválido'),
        errorCase('POST marca duplicada', 'POST', '/marca', { nombre: '{{marcaExistente}}' }, 409, 'DB_UNIQUE_VIOLATION', 'Usa el nombre de una marca que ya existe.'),
        errorCase('PATCH notificación inexistente', 'PATCH', '/notificacion/999999/leer', undefined, 404, 'no encontrada; la sesión sigue viva'),
        buildRequest({
            name: '[200] La sesión sigue viva tras el 404', method: 'GET', path: '/usuario/me',
            tests: ["pm.test('200: el 404 no cerró la sesión', () => pm.response.to.have.status(200));"],
            description: 'Se ejecuta después de "PATCH notificación inexistente": un error ya no borra las cookies.',
        }),
        errorCase('Ruta inexistente', 'GET', '/esta-ruta-no-existe', undefined, 404, 'Ruta no encontrada (JSON, no HTML)'),
        errorCase('Alias de contraseña retirado', 'PATCH', '/usuario/{{id}}/contraseña', { 'contraseña': 'Segura12' }, 404, 'la ruta vigente es /contrasenia'),
        errorCase('DELETE de trato retirado', 'DELETE', '/trato-empresa-garage/{{id}}', undefined, 404, 'se cancela con PATCH /:id/cancelar'),
        errorCase('Trato directo sin ser superadmin', 'POST', '/trato-empresa-garage', { id_sede: 1, id_garage: 1, cantidad_cocheras: 1 }, 403, 'solo el superadmin; el admin usa una solicitud', 'Ejecutar con la sesión de un admin (rol 1).'),
        errorCase('Verificar pago con id no numérico', 'POST', '/payments/abc/verificar', {}, 400, 'invalid_payment_id'),
        errorCase('Verificar por referencia sin externalReference', 'POST', '/payments/verificar', {}, 400, 'externalReference es requerido'),
        buildRequest({
            name: '[401] Webhook con firma inválida', method: 'POST', path: '/payments/webhook', auth: false,
            body: { id: 'evt-demo', type: 'payment.updated', data: { id: '100' } },
            tests: expectStatus(401, 'Firma de webhook inválida (antes 400)'),
            description: 'Sin headers x-signature / x-request-id. Con MP_WEBHOOK_SECRET sin configurar responde 503.',
        }),
    ],
};

const variables = [
    { key: 'url', value: 'http://localhost:3000/api' },
    { key: 'accessToken', value: '' },
    { key: 'email', value: '' },
    { key: 'password', value: '' },
    { key: 'marcaExistente', value: '' },
    { key: 'externalReference', value: '' },
    { key: 'preferenceId', value: '' },
    ...['id', 'id_garage', 'id_usuario', 'id_empresa', 'paymentId'].map((key) => ({ key, value: '1' })),
];

const collection = {
    info: {
        _postman_id: COLLECTION_ID,
        name: 'SmartLot',
        description: 'Generada con `npm run postman:generate` desde el router real (ver docs/plans-franC/api.md). Ejecutar primero "POST /usuario/login" con las variables email y password: guarda el token en {{accessToken}}. No contiene credenciales.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
    variable: variables,
    item: [...folders, errorFolder],
};

writeFileSync(TARGET, JSON.stringify(collection, null, 4) + '\n');
console.log(`Colección escrita: ${routes.length} endpoints en ${folders.length} carpetas + ${errorFolder.item.length} casos de error`);
process.exit(0);

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';

// No conexiones externas: SQL, correo e identidad controlados por este fixture.
process.env.BCRYPT_ROUNDS = '4';
let row, inserted, administrator, company, existingUser, mailFails;
const mails = [];
const client = {
    release() {},
    async query(sql, params = []) {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO solicitudes_registro')) {
            inserted = Object.freeze({
                id: 7, nombre: params[0], apellido: params[1], email: params[2], telefono: params[3],
                contraseña_hash: params[4], empresa_nombre: params[5], empresa_descripcion: params[6],
                estado: params[7], created_at: '2026-01-01T00:00:00.000Z',
            });
            row = inserted;
            return { rows: [row], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE solicitudes_registro')) {
            row = Object.freeze({ ...row, estado: params[0], revisada_por: params[1] });
            return { rows: [row], rowCount: 1 };
        }
        if (sql.includes('FROM usuarios')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM solicitudes_registro')) {
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        throw new Error(`SQL inesperado: ${sql}`);
    },
};
mock.module('../src/database/db.js', { defaultExport: { query: client.query, connect: async () => client } });
mock.module('../src/repositories/usuarioRepository.js', { defaultExport: class {
    getByEmailAsync = async () => existingUser;
    getSuperadminsActivosAsync = async () => [{ email: 'super@example.test', nombre: 'Super' }];
    createWithClientAsync = async (entity, connection) => {
        assert.equal(connection, client);
        administrator = Object.freeze({ id: 20, ...entity });
        return administrator;
    };
} });
mock.module('../src/repositories/empresaRepository.js', { defaultExport: class {
    createWithClientAsync = async (entity, connection) => {
        assert.equal(connection, client);
        company = { id: 10, ...entity };
        return company;
    };
} });
mock.module('../src/services/rolService.js', { defaultExport: class {
    getByIdAsync = async () => ({ id: 1, tipo_rol: 'admin' });
} });
mock.module('../src/services/emailService.js', { namedExports: {
    enviarCorreoDesdePlantilla: async (...args) => {
        mails.push(args);
        if (mailFails) throw new Error('Correo de prueba no disponible');
    },
} });
mock.module('../src/middlewares/authMiddleware.js', { defaultExport: (req, res, next) => {
    req.usuario = { id: 99, id_rol: 4, tipo_rol: 'superadmin' };
    next();
} });

const { default: router } = await import('../src/controllers/solicitudRegistroController.js');
const app = express();
app.use(express.json());
app.use('/api/solicitud-registro', router);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
const path = '/api/solicitud-registro';
const input = {
    nombre: 'Ana', apellido: 'Prueba', email: 'ana@example.test', telefono: '1123456789',
    contraseña: 'SEgura12!!', empresa_nombre: 'Empresa de prueba', empresa_descripcion: 'Flota',
};

function reset() {
    row = inserted = administrator = company = existingUser = null;
    mailFails = false;
    mails.length = 0;
}

function assertSafe(body) {
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            assert.ok(!['contraseña', 'contraseña_hash'].includes(key), `Campo secreto: ${key}`);
            visit(child);
        }
    };
    visit(body);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(input.contraseña));
    assert.ok(!serialized.includes(inserted.contraseña_hash));
}

test('SEG-07: creación HTTP conserva contrato y hash interno sin exponer secretos', async () => {
    reset();
    const response = await request(app).post(path).send(input).expect(201);
    assert.equal(response.body.message, 'Solicitud enviada. Un superadmin la validará a la brevedad.');
    const { contraseña: password, ...publicInput } = input;
    assert.deepEqual(response.body.solicitud, {
        id: 7, ...publicInput, estado: 'pendiente', created_at: inserted.created_at,
    });
    assert.match(inserted.contraseña_hash, /^\$2[aby]\$\d{2}\$/);
    assert.equal(await bcrypt.compare(password, inserted.contraseña_hash), true);
    assertSafe(response.body);
    assert.equal(mails.length, 1);
    assert.equal(mails[0][1], 'solicitud_registro_superadmin');
});

test('SEG-07: listado, consulta y aprobación HTTP sanitizan objetos anidados y reutilizan el hash', async () => {
    reset();
    await request(app).post(path).send(input).expect(201);
    const originalHash = inserted.contraseña_hash;
    for (const url of [path, `${path}/7`]) {
        const response = await request(app).get(url).expect(200);
        assertSafe(response.body);
    }
    const response = await request(app).patch(`${path}/7/aprobar`).expect(200);
    assertSafe(response.body);
    assert.equal(response.body.solicitud.estado, 'aceptada');
    assert.equal(response.body.solicitud.revisada_por, 99);
    assert.deepEqual(response.body.empresa, company);
    assert.equal(response.body.usuario.id_empresa, company.id);
    assert.equal(response.body.usuario.id_rol, 1);
    assert.equal(administrator.contraseña, originalHash);
    assert.equal(inserted.contraseña_hash, originalHash);
    assert.equal(row.contraseña_hash, originalHash);
    assert.equal(await bcrypt.compare(input.contraseña, administrator.contraseña), true);
    assert.equal(mails.at(-1)[1], 'bienvenida');
});

test('SEG-07: rechazo HTTP conserva el hash interno y no lo devuelve', async () => {
    reset();
    await request(app).post(path).send(input).expect(201);
    const response = await request(app).patch(`${path}/7/rechazar`).expect(200);
    assertSafe(response.body);
    assert.equal(response.body.estado, 'rechazada');
    assert.equal(response.body.revisada_por, 99);
    assert.equal(row.contraseña_hash, inserted.contraseña_hash);
    assert.equal(mails.at(-1)[1], 'solicitud_rechazada');
});

test('SEG-07: HTTP mantiene validaciones, duplicados y correo best-effort', async () => {
    reset();
    await request(app).post(path).send({ ...input, contraseña: 'debil' }).expect(400);
    assert.equal(inserted, null);
    existingUser = { id: 20 };
    await request(app).post(path).send(input).expect(409);
    assert.equal(inserted, null);
    existingUser = null;
    mailFails = true;
    const response = await request(app).post(path).send(input).expect(201);
    assertSafe(response.body);
    assert.equal(mails.length, 1);
    await request(app).post(path).send(input).expect(409);
    assert.equal(mails.length, 1);
});

// Sólo PostgreSQL LOCAL explícito: nunca utiliza DATABASE_URL ni Supabase.
// TEST_RESERVATION_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const url = process.env.TEST_RESERVATION_DATABASE_URL;
if (url && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Estas pruebas sólo permiten PostgreSQL local.');
}

test('límites de reservas y autorización sobre PostgreSQL local real', { skip: !url }, async (t) => {
    const schema = `reservation_limit_test_${process.pid}_${Date.now()}`;
    const setup = new pg.Pool({ connectionString: url, ssl: false });
    await setup.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: url, ssl: false, options: `-c search_path=${schema} -c timezone=UTC` });
    mock.module('../src/database/db.js', { defaultExport: pool });
    process.env.JWT_SECRET = 'reservation-limit-local-test-secret';
    const { default: ReservaService } = await import('../src/services/reservaService.js');
    const { default: UsuarioRepository } = await import('../src/repositories/usuarioRepository.js');
    const { default: usuarioRouter } = await import('../src/controllers/usuarioController.js');
    const { default: reservaRouter } = await import('../src/controllers/reservaController.js');
    const { default: auth } = await import('../src/middlewares/authMiddleware.js');
    const { default: errors } = await import('../src/middlewares/errorHandler.js');
    const svc = new ReservaService();
    const usuarios = new UsuarioRepository();
    const app = express();
    app.use(express.json());
    app.use('/api/usuario', usuarioRouter);
    app.use('/api/reserva', auth, reservaRouter);
    app.use(errors);
    const employee = { id: 7, id_rol: 2, id_empresa: 2, id_sede: 3 };
    const admin = { id: 1, id_rol: 1, id_empresa: 2, id_sede: null };
    const token = (id) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;
    const entity = (hour = 9, garage = 5) => ({ id_usuario: 7, id_vehiculo: 11, id_garage: garage,
        fecha_entrada: `2099-01-10 ${String(hour).padStart(2, '0')}:00:00`,
        fecha_salida: `2099-01-10 ${String(hour + 1).padStart(2, '0')}:00:00`, dia: 'Lunes' });
    const reset = async (limit = null) => {
        await pool.query('TRUNCATE reservas RESTART IDENTITY');
        await pool.query('UPDATE usuarios SET limite_reservas_activas=$1 WHERE id=7', [limit]);
        await pool.query("UPDATE trato_empresa_garage SET cantidad_cocheras=10, modalidad_pago='empresa_cubre_cupo', precio_auto=100");
        await pool.query('UPDATE garages SET capacidad=20');
    };
    try {
        await pool.query(`
            CREATE TYPE estado_reserva_enum AS ENUM ('pendiente_pago','confirmada','cancelada','expirada');
            CREATE TABLE roles (id int PRIMARY KEY, tipo_rol text, "Borrado" boolean DEFAULT false);
            CREATE TABLE sedes (id int PRIMARY KEY, id_empresa int, "Borrado" boolean DEFAULT false);
            CREATE TABLE usuarios (id serial PRIMARY KEY, id_rol int, activo boolean DEFAULT true, id_empresa int,
                id_sede int, "Borrado" boolean DEFAULT false, "UpdateBy" int, "UpdateAt" timestamptz,
                nombre text, apellido text, email text, telefono text, contraseña text, token_version int DEFAULT 0);
            CREATE TABLE usuario_garage (id_usuario int, id_garage int);
            CREATE TABLE vehiculos (id int PRIMARY KEY, id_usuario int, tipo_vehiculo text, "Borrado" boolean DEFAULT false);
            CREATE TABLE garages (id int PRIMARY KEY, capacidad int, estado boolean DEFAULT true,
                id_sede_propia int, "Borrado" boolean DEFAULT false);
            CREATE TABLE trato_empresa_garage (id int PRIMARY KEY, id_sede int, id_garage int, cantidad_cocheras int,
                modalidad_pago text, precio_auto numeric, "Borrado" boolean DEFAULT false);
            CREATE TABLE reservas (id serial PRIMARY KEY, id_usuario int, id_garage int, id_vehiculo int,
                fecha_entrada timestamp, fecha_salida timestamp, entro boolean DEFAULT false, salio boolean DEFAULT false,
                "Borrado" boolean DEFAULT false, dia text, id_trato int, modalidad_pago_aplicada text, tipo_cupo text,
                responsable_pago text, tarifa_hora_aplicada numeric, importe_estimado numeric,
                estado_reserva estado_reserva_enum, retencion_pago_hasta timestamptz,
                qr_token uuid DEFAULT gen_random_uuid(), qr_salida_token uuid);
        `);
        const migration = (await readFile(new URL('../migrations/20261001_001_add_user_active_reservation_limit.sql', import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
        await t.test('migración reproducible e idempotente', async () => {
            await pool.query(migration);
            await pool.query(migration);
            await assert.rejects(pool.query('INSERT INTO usuarios(limite_reservas_activas) VALUES(-1)'), { code: '23514' });
        });
        await pool.query(`
            INSERT INTO roles VALUES (1,'admin',false),(2,'cliente',false),(4,'superadmin',false);
            INSERT INTO sedes(id,id_empresa) VALUES(3,2),(4,2),(8,8);
            INSERT INTO usuarios(id,id_rol,id_empresa,id_sede,contraseña) VALUES
                (1,1,2,NULL,'hash'),(2,1,2,3,'hash'),(3,1,8,NULL,'hash'),(4,4,NULL,NULL,'hash'),
                (7,2,2,3,'hash'),(8,2,2,4,'hash'),(9,2,8,8,'hash');
            INSERT INTO vehiculos(id,id_usuario,tipo_vehiculo) VALUES(11,7,'auto'),(12,8,'auto');
            INSERT INTO garages(id,capacidad,id_sede_propia) VALUES(5,20,3),(6,20,NULL);
            INSERT INTO trato_empresa_garage(id,id_sede,id_garage,cantidad_cocheras,modalidad_pago,precio_auto)
                VALUES(13,3,5,10,'empresa_cubre_cupo',100),(14,3,6,10,'empresa_cubre_cupo',100);
        `);
        await t.test('NULL permite tres reservas no superpuestas el mismo día; no existe máximo diario oculto', async () => {
            await reset();
            for (const hour of [9, 11, 13]) await svc.createAsync(entity(hour), employee);
            assert.equal(await svc.repo.countActiveByUserAsync(7), 3);
        });
        await t.test('cero rechaza creación HTTP con 409, code y details', async () => {
            await reset(0);
            const res = await request(app).post('/api/reserva').set('Authorization', token(7)).send(entity());
            assert.equal(res.status, 409);
            assert.equal(res.body.code, 'RESERVATION_LIMIT_REACHED');
            assert.deepEqual(res.body.details, { limit: 0, current: 0 });
            assert.equal(await svc.repo.countActiveByUserAsync(7), 0);
        });
        await t.test('dos creaciones cuentan y una tercera se rechaza', async () => {
            await reset(2);
            await svc.createAsync(entity(9), employee);
            await svc.createAsync(entity(11), employee);
            await assert.rejects(svc.createAsync(entity(13), employee), { code: 'RESERVATION_LIMIT_REACHED' });
        });
        await t.test('conteo exacto: pago, futuro, en uso vencido, salida, cancelación, expiración y borrado', async () => {
            await reset();
            const cases = [
                ['pendiente_pago', false, false, false, "NOW()+interval '10 minutes'", "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '1 hour'", 1],
                ['pendiente_pago', false, false, false, "NOW()-interval '1 minute'", "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '1 hour'", 0],
                ['confirmada', false, false, false, 'NULL', "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '1 minute'", 1],
                ['confirmada', true, false, false, 'NULL', "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' - interval '1 hour'", 1],
                ['confirmada', true, true, false, 'NULL', "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '1 hour'", 0],
                ['confirmada', false, false, false, 'NULL', "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' - interval '1 minute'", 0],
                ['cancelada', false, false, false, 'NULL', "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '1 hour'", 0],
                ['expirada', false, false, false, 'NULL', "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '1 hour'", 0],
                ['confirmada', false, false, true, 'NULL', "NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '1 hour'", 0],
            ];
            for (const [state, entered, left, deleted, hold, end, expected] of cases) {
                await pool.query('TRUNCATE reservas');
                await pool.query(`INSERT INTO reservas(id_usuario,estado_reserva,entro,salio,"Borrado",retencion_pago_hasta,fecha_salida)
                    VALUES(7,$1,$2,$3,$4,${hold},${end})`, [state, entered, left, deleted]);
                assert.equal(await svc.repo.countActiveByUserAsync(7), expected, JSON.stringify([state, entered, left, deleted]));
            }
        });
        await t.test('retención vencida se expira antes de insertar y libera el límite', async () => {
            await reset(1);
            await pool.query("INSERT INTO reservas(id_usuario,estado_reserva,retencion_pago_hasta) VALUES(7,'pendiente_pago',NOW()-interval '1 minute')");
            await svc.createAsync(entity(), employee);
            assert.equal((await pool.query('SELECT estado_reserva FROM reservas WHERE id=1')).rows[0].estado_reserva, 'expirada');
            assert.equal(await svc.repo.countActiveByUserAsync(7), 1);
        });
        await t.test('garages propios/externos, pagos empresa/empleado, dentro/extra consumen el mismo límite', async () => {
            await reset(2);
            const corporate = await svc.createAsync(entity(9, 5), employee);
            await pool.query("UPDATE trato_empresa_garage SET cantidad_cocheras=0 WHERE id_garage=6");
            const paid = await svc.createAsync(entity(11, 6), employee);
            assert.equal(corporate.responsable_pago, 'empresa');
            assert.equal(corporate.tipo_cupo, 'dentro_cupo');
            assert.equal(paid.responsable_pago, 'empleado');
            assert.equal(paid.tipo_cupo, 'extra');
            assert.equal(paid.estado_reserva, 'pendiente_pago');
            assert.ok(new Date(paid.retencion_pago_hasta) > new Date());
            assert.ok(corporate.qr_token === undefined && paid.qr_token === undefined);
            await assert.rejects(svc.createAsync(entity(13, 5), employee), { code: 'RESERVATION_LIMIT_REACHED' });
            await reset(1);
            await pool.query("UPDATE trato_empresa_garage SET modalidad_pago='empleado_paga' WHERE id_garage=5");
            const employeePaid = await svc.createAsync(entity(9, 5), employee);
            assert.equal(employeePaid.tipo_cupo, 'dentro_cupo');
            assert.equal(employeePaid.responsable_pago, 'empleado');
            await assert.rejects(svc.createAsync(entity(11, 6), employee), { code: 'RESERVATION_LIMIT_REACHED' });
        });
        await t.test('bajar límite mantiene reservas/pagos; NULL elimina bloqueo y guarda auditoría', async () => {
            await reset();
            for (const hour of [9, 11, 13]) await svc.createAsync(entity(hour), employee);
            const before = (await pool.query('SELECT * FROM reservas ORDER BY id')).rows;
            await usuarios.updateReservationLimitAsync(7, 1, admin);
            assert.deepEqual((await pool.query('SELECT * FROM reservas ORDER BY id')).rows, before);
            await assert.rejects(svc.createAsync(entity(15), employee), { code: 'RESERVATION_LIMIT_REACHED' });
            await usuarios.updateReservationLimitAsync(7, null, admin);
            await svc.createAsync(entity(15), employee);
            const audit = (await pool.query('SELECT "UpdateBy", "UpdateAt" FROM usuarios WHERE id=7')).rows[0];
            assert.equal(audit.UpdateBy, 1);
            assert.ok(audit.UpdateAt);
        });
        await t.test('cotización informa la política con límite y sin límite', async () => {
            await reset(2);
            await svc.createAsync(entity(9), employee);
            assert.deepEqual((await svc.quoteAsync(entity(11), employee)).politicaReservas, { sinLimite: false, limite: 2, activas: 1, restantes: 1 });
            await usuarios.updateReservationLimitAsync(7, null, admin);
            assert.deepEqual((await svc.quoteAsync(entity(11), employee)).politicaReservas, { sinLimite: true, limite: null, activas: 1, restantes: null });
        });
        await t.test('edición mantiene un solo lugar incluso después de bajar límite y no reactiva expiradas', async () => {
            await reset(1);
            const reservation = await svc.createAsync(entity(), employee);
            await usuarios.updateReservationLimitAsync(7, 0, admin);
            await svc.repo.updateWithLimitAsync(reservation.id, { ...reservation, ...entity(11) });
            assert.equal(await svc.repo.countActiveByUserAsync(7), 1);
            await pool.query("UPDATE reservas SET estado_reserva='expirada' WHERE id=$1", [reservation.id]);
            await assert.rejects(svc.repo.updateWithLimitAsync(reservation.id, { ...reservation, ...entity(13) }), { statusCode: 409 });
        });
        await t.test('dos peticiones simultáneas no superan el límite global en garages diferentes', async () => {
            await reset(2);
            await svc.createAsync(entity(9), employee);
            const results = await Promise.all([
                request(app).post('/api/reserva').set('Authorization', token(7)).send(entity(11, 5)),
                request(app).post('/api/reserva').set('Authorization', token(7)).send(entity(13, 6)),
            ]);
            assert.deepEqual(results.map((res) => res.status).sort(), [201, 409]);
            assert.equal(results.find((res) => res.status === 409).body.code, 'RESERVATION_LIMIT_REACHED');
            assert.equal(await svc.repo.countActiveByUserAsync(7), 2);
        });
        await t.test('la segunda transacción espera el bloqueo de usuario y cuenta después del primer COMMIT', async () => {
            await reset(1);
            const first = await pool.connect();
            const second = await pool.connect();
            let pending;
            try {
                await first.query('BEGIN');
                await second.query('BEGIN');
                const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
                await svc.repo.quoteAndCreateWithClientAsync(entity(9, 5), first);
                // Capturar inmediatamente el rechazo para evitar unhandledRejection.
                pending = svc.repo.quoteAndCreateWithClientAsync(entity(11, 6), second).then(
                    () => null, (error) => error
                );
                let waiting = false;
                for (let i = 0; i < 100 && !waiting; i++) {
                    const row = (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
                    waiting = row?.wait_event_type === 'Lock';
                    if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
                }
                assert.equal(waiting, true, 'PostgreSQL debe mostrar la segunda transacción esperando un lock');
                await first.query('COMMIT');
                const error = await pending;
                assert.equal(error?.code, 'RESERVATION_LIMIT_REACHED');
                assert.deepEqual(error.details, { limit: 1, current: 1 });
                await second.query('ROLLBACK');
                assert.equal(await svc.repo.countActiveByUserAsync(7), 1);
            } finally {
                await first.query('ROLLBACK');
                if (pending) await pending;
                await second.query('ROLLBACK');
                first.release();
                second.release();
            }
        });
        await t.test('endpoint rechaza sesión ausente, empleado, otra empresa y otra sede', async () => {
            const patch = (actorId, targetId, body) => request(app).patch(`/api/usuario/${targetId}/limite-reservas`)
                .set('Authorization', token(actorId)).send(body);
            assert.equal((await request(app).patch('/api/usuario/7/limite-reservas').send({ limiteReservasActivas: 2 })).status, 401);
            assert.equal((await patch(7, 7, { limiteReservasActivas: 2 })).status, 403);
            assert.equal((await patch(3, 7, { limiteReservasActivas: 2, id_empresa: 2, id_admin: 1 })).status, 403);
            assert.equal((await patch(2, 8, { limiteReservasActivas: 2, id_sede: 4 })).status, 403);
            assert.equal((await patch(1, 9, { limiteReservasActivas: 2 })).status, 403);
            assert.equal((await patch(1, 99999, { limiteReservasActivas: 2 })).status, 404);
            assert.equal((await patch(1, 1, { limiteReservasActivas: 2 })).status, 404);
            await pool.query('UPDATE usuarios SET activo=false WHERE id=8');
            assert.equal((await patch(1, 8, { limiteReservasActivas: 2 })).status, 404);
            await pool.query('UPDATE usuarios SET activo=true WHERE id=8');
            for (const body of [{}, { limiteReservasActivas: -1 }, { limiteReservasActivas: '2' }, { limiteReservasActivas: 1.1 }, { limiteReservasActivas: 32768 }]) {
                assert.equal((await patch(1, 7, body)).status, 400);
            }
            assert.equal((await request(app).patch('/api/usuario/7/limite-reservas').set('Authorization', token(1))
                .set('Content-Type', 'application/json').send('{"limiteReservasActivas":NaN}')).status, 400);
            const success = await patch(2, 7, { limiteReservasActivas: 2, id_empresa: 99 });
            assert.equal(success.status, 200);
            assert.deepEqual(success.body, { idUsuario: 7, limiteReservasActivas: 2 });
            assert.equal((await patch(4, 9, { limiteReservasActivas: null })).status, 200);
            const employees = await request(app).get('/api/usuario').set('Authorization', token(1));
            assert.equal(employees.status, 200);
            assert.equal(employees.body.find((row) => row.id === 7).limiteReservasActivas, 2);
            assert.ok(employees.body.every((row) => !Object.hasOwn(row, 'contraseña')));
        });
        await t.test('alta de empleado persiste límite opcional y por defecto NULL', async () => {
            const base = { id_rol: 2, nombre: 'Prueba', apellido: 'Local', id_sede: 3, id_empresa: 2,
                email: 'empleado@invalid.local', telefono: null, contraseña: 'hash-local', activo: true };
            // IDs explícitos del fixture no avanzan la secuencia serial.
            await pool.query("SELECT setval(pg_get_serial_sequence('usuarios','id'),100)");
            const unlimited = await usuarios.createAsync(base);
            assert.equal(unlimited.limite_reservas_activas, null);
            const limited = await usuarios.createAsync({ ...base, limite_reservas_activas: 2 });
            assert.equal(limited.limite_reservas_activas, 2);
        });
        await t.test('se mantienen validaciones de vehículo, tarifa, solapamiento, capacidad y trato', async () => {
            await reset();
            await assert.rejects(svc.createAsync({ ...entity(), id_vehiculo: 12 }, employee), { statusCode: 403 });
            await pool.query('UPDATE trato_empresa_garage SET precio_auto=NULL');
            // Tipo desconocido siempre debe fallar, independientemente de tarifas.
            await pool.query("UPDATE vehiculos SET tipo_vehiculo='camion' WHERE id=11");
            await assert.rejects(svc.createAsync(entity(), employee), { statusCode: 409 });
            await pool.query("UPDATE vehiculos SET tipo_vehiculo='auto' WHERE id=11");
            await reset();
            await svc.createAsync(entity(), employee);
            await assert.rejects(svc.createAsync(entity(), employee), { statusCode: 409 });
            await pool.query('UPDATE garages SET capacidad=0');
            await assert.rejects(svc.createAsync(entity(11), employee), { statusCode: 409 });
            await reset();
            await pool.query('UPDATE trato_empresa_garage SET "Borrado"=true');
            await assert.rejects(svc.createAsync(entity(), employee), { statusCode: 409 });
        });
    } finally {
        mock.restoreAll();
        await pool.end();
        await setup.query(`DROP SCHEMA ${schema} CASCADE`);
        await setup.end();
    }
});

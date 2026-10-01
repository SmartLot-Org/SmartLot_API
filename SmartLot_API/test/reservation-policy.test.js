import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateReservationLimit, reservationPolicy, enforceReservationLimit } from '../src/helpers/reservationPolicy.js';
import errorHandler from '../src/middlewares/errorHandler.js';

test('acepta null y enteros smallint, rechaza omitidos, strings, decimales y no finitos', () => {
    for (const value of [null, 0, 2, 32767]) assert.equal(validateReservationLimit(value), value);
    for (const value of [undefined, -1, 32768, 1.5, '2', '', NaN, Infinity, true, {}, []]) {
        assert.throws(() => validateReservationLimit(value), { statusCode: 400 });
    }
});

test('null no bloquea, cero bloquea, límite alcanzado devuelve 409 identificable', () => {
    enforceReservationLimit(null, 100);
    enforceReservationLimit(2, 1);
    for (const [limit, current] of [[0, 0], [2, 2], [1, 3]]) {
        assert.throws(() => enforceReservationLimit(limit, current), (error) => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.code, 'RESERVATION_LIMIT_REACHED');
            assert.deepEqual(error.details, { limit, current });
            return true;
        });
    }
});

test('cotización serializa sin Infinity y nunca muestra restantes negativos', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(reservationPolicy(null, 3))), {
        sinLimite: true, limite: null, activas: 3, restantes: null,
    });
    assert.deepEqual(reservationPolicy(2, 1), { sinLimite: false, limite: 2, activas: 1, restantes: 1 });
    assert.equal(reservationPolicy(1, 3).restantes, 0);
});

test('middleware conserva code, details y mensaje específico sin convertir a 500', () => {
    let error;
    try { enforceReservationLimit(2, 2); } catch (caught) { error = caught; }
    const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
    errorHandler(error, {}, res, () => {});
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'RESERVATION_LIMIT_REACHED');
    assert.deepEqual(res.body.details, { limit: 2, current: 2 });
    assert.equal(res.body.message, error.message);
});

test('desaparece la regla diaria antigua y su consulta que ignoraba errores', async () => {
    const service = await readFile(new URL('../src/services/reservaService.js', import.meta.url), 'utf8');
    const repo = await readFile(new URL('../src/repositories/reservaRepository.js', import.meta.url), 'utf8');
    assert.doesNotMatch(service + repo, /_validarMaximoReservasDiariasAsync|getCountByUsuarioAndDateAsync|maximo de reservas en un dia son 2/);
});

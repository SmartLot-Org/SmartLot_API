import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveMailtrapHttpsAgent } = await import('../src/services/emailService.js');

const FAKE_PEM = '-----BEGIN CERTIFICATE-----\nABCDEF\n-----END CERTIFICATE-----';

function withEnv(vars, fn) {
    const prev = {};
    for (const key of Object.keys(vars)) {
        prev[key] = process.env[key];
        if (vars[key] === undefined) delete process.env[key];
        else process.env[key] = vars[key];
    }
    try {
        return fn();
    } finally {
        for (const key of Object.keys(vars)) {
            if (prev[key] === undefined) delete process.env[key];
            else process.env[key] = prev[key];
        }
    }
}

test('EMAIL_CA_CERT usa validación estricta con la CA personalizada', () => {
    withEnv({ EMAIL_CA_CERT: FAKE_PEM.replace(/\n/g, '\\n'), NODE_ENV: 'development' }, () => {
        const agent = resolveMailtrapHttpsAgent();
        assert.ok(agent);
        assert.equal(agent.options.rejectUnauthorized, true);
        assert.match(agent.options.ca, /BEGIN CERTIFICATE/);
        assert.ok(!agent.options.ca.includes('\\n'));
    });
});

test('fuera de producción sin CA usa validación relajada', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
        withEnv({ EMAIL_CA_CERT: undefined, NODE_ENV: nodeEnv }, () => {
            const agent = resolveMailtrapHttpsAgent();
            assert.ok(agent);
            assert.equal(agent.options.rejectUnauthorized, false);
        });
    }
});

test('en producción sin CA delega al agente estricto del SDK', () => {
    withEnv({ EMAIL_CA_CERT: undefined, NODE_ENV: 'production' }, () => {
        assert.equal(resolveMailtrapHttpsAgent(), null);
    });
});

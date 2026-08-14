import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const sends = [];

mock.module('mailtrap', {
    namedExports: {
        MailtrapClient: class {
            constructor(config) { this.config = config; }
            async send(params) {
                sends.push(params);
                return { success: true, message_ids: ['msg-1'] };
            }
        }
    }
});

mock.module('../src/database/dbClient.js', {
    namedExports: {
        pool: {
            query: async () => { throw new Error('DB caída'); }
        }
    }
});

process.env.FRONTEND_URL = 'https://app.smartlot.com';

const { renderPlantilla, escaparHtml, cargarPlantilla, enviarCorreoDesdePlantilla } =
    await import('../src/services/emailService.js');

test.beforeEach(() => {
    sends.length = 0;
});

test('escaparHtml escapa caracteres peligrosos', () => {
    assert.equal(escaparHtml('<b>&"\'x'), '&lt;b&gt;&amp;&quot;&#39;x');
    assert.equal(escaparHtml(null), '');
});

test('renderPlantilla reemplaza variables conocidas y escapa valores', () => {
    const plantilla = {
        asunto: 'Hola {{nombre}}',
        header_html: '<header>{{nombre}}</header>',
        cuerpo_html: '<p>{{email}}</p>',
        footer_html: '<footer>{{anio}} {{link_login}}</footer>'
    };
    const { asunto, html } = renderPlantilla(plantilla, { nombre: 'Juan <script>', email: 'juan@x.com' });

    assert.equal(asunto, 'Hola Juan &lt;script&gt;');
    assert.match(html, /<header>Juan &lt;script&gt;<\/header>/);
    assert.match(html, /<p>juan@x\.com<\/p>/);
});

test('renderPlantilla inyecta link_login y anio como variables de sistema', () => {
    const plantilla = {
        asunto: '',
        header_html: '',
        cuerpo_html: '<a href="{{link_login}}">{{anio}}</a>',
        footer_html: ''
    };
    const { html } = renderPlantilla(plantilla, {});

    assert.match(html, /href="https:\/\/app\.smartlot\.com\/login"/);
    assert.match(html, /<a[^>]*>\d{4}<\/a>/);
});

test('renderPlantilla deja intactas las variables desconocidas', () => {
    const plantilla = {
        asunto: '{{faltante}}',
        header_html: '',
        cuerpo_html: '<p>{{desconocida}}</p>',
        footer_html: ''
    };
    const { asunto, html } = renderPlantilla(plantilla, {});

    assert.equal(asunto, '{{faltante}}');
    assert.match(html, /\{\{desconocida\}\}/);
});

test('cargarPlantilla devuelve null si la base de datos falla', async () => {
    assert.equal(await cargarPlantilla('bienvenida'), null);
});

test('enviarCorreoDesdePlantilla usa plantilla de respaldo si la DB falla', async () => {
    const result = await enviarCorreoDesdePlantilla('dest@x.com', 'bienvenida', { nombre: 'Ana', email: 'dest@x.com' });

    assert.equal(result.success, true);
    assert.equal(result.messageId, 'msg-1');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].to[0].email, 'dest@x.com');
    assert.equal(sends[0].subject, 'Bienvenido a SmartLot');
    assert.match(sends[0].html, /¡Hola, Ana!/);
});

test('enviarCorreoDesdePlantilla lanza error si no existe ni plantilla ni respaldo', async () => {
    await assert.rejects(
        () => enviarCorreoDesdePlantilla('dest@x.com', 'plantilla_inexistente', {}),
        /No existe la plantilla de correo "plantilla_inexistente"\./
    );
});
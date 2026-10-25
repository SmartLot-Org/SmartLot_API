// Uso:
//   npm run routes:inventory           imprime el inventario en Markdown
//   npm run routes:inventory -- --write   lo escribe entre los marcadores de docs/plans-franC/api.md
import { mock } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';

// Importar src/app.js instancia la base y el correo: se simulan para no tocar servicios reales.
mock.module(new URL('../src/database/db.js', import.meta.url).href, {
    defaultExport: { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
});
mock.module(new URL('../src/services/emailService.js', import.meta.url).href, {
    namedExports: { enviarCorreoDesdePlantilla: async () => {}, enviarCorreo: async () => {}, renderPlantilla: async () => '', invalidarCachePlantilla: () => {} },
});

const { collectRoutes, renderMarkdown, INVENTORY_START, INVENTORY_END } = await import('./api-inventory.mjs');
const markdown = renderMarkdown(await collectRoutes());

if (process.argv.includes('--write')) {
    const target = new URL('../docs/plans-franC/api.md', import.meta.url);
    const current = readFileSync(target, 'utf8');
    const crlf = current.includes('\r\n');
    const text = crlf ? current.replace(/\r\n/g, '\n') : current;
    const start = text.indexOf(INVENTORY_START);
    const end = text.indexOf(INVENTORY_END);
    if (start < 0 || end < 0) throw new Error('docs/plans-franC/api.md no tiene los marcadores del inventario');
    const next = text.slice(0, start) + markdown + text.slice(end + INVENTORY_END.length);
    writeFileSync(target, crlf ? next.replace(/\n/g, '\r\n') : next);
    console.log('docs/plans-franC/api.md actualizado');
} else {
    console.log(markdown);
}
process.exit(0);

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const root = new URL('../dist/', import.meta.url);
const allowed = new Set([
    'index.html',
    'style.css',
    'app.js',
    'chat-render.js',
    'runtime-config.js',
    'browser-runtime.js',
    'vendor/marked.js',
    'vendor/purify.js',
]);
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
const port = Number(process.env.STATIC_PORT || 4173);
createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!allowed.has(file)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    try {
        const body = readFileSync(new URL(file, root));
        res.writeHead(200, { 'Content-Type': `${types[file.split('.').at(-1)]}; charset=utf-8` });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end('请先运行 npm run build:static');
    }
}).listen(port, '127.0.0.1', () => console.log(`Static Agent: http://127.0.0.1:${port}`));

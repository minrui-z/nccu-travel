import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const base = arg('--base', '/');
if (!base.startsWith('/') || !base.endsWith('/'))
  throw new Error('Base must start and end with /.');
const root = resolve('dist'),
  port = Number(arg('--port', '4173'));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xls': 'application/vnd.ms-excel',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
};
const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, 'http://127.0.0.1').pathname,
    );
    if (!['GET', 'HEAD'].includes(req.method) || !path.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    const file = resolve(root, path.slice(base.length) || 'index.html');
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log('Static preview: http://127.0.0.1:' + port + base),
);

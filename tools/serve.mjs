// 轻量静态服务器：用于在浏览器中预览/自测渲染层（store 自动回退为页内内存仓库）
// 用法：node tools/serve.mjs  →  http://localhost:8613/src/renderer/index.html
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8613;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(path.normalize(ROOT))) {
      res.writeHead(403);
      res.end('403');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('404 ' + urlPath);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`[serve] http://localhost:${PORT}/src/renderer/index.html`);
  });

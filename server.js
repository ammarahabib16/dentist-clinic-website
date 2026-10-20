const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad Request');
  }

  let relativePath = decodedUrl === '/' ? '/index.html' : decodedUrl;
  let filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const isCode = ext === '.html' || ext === '.css' || ext === '.js';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': isCode ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n===========================================`);
  console.log(` Server is running and accessible at:`);
  console.log(` > Local:    http://localhost:${PORT}/`);
  console.log(` > Network:  http://127.0.0.1:${PORT}/`);
  console.log(`===========================================\n`);
});

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
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4'
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
    const cacheControl = isCode ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000';
    const range = req.headers.range;

    // Static hosts support byte ranges automatically; this local server has to
    // do it explicitly so `preload="metadata"` can read the MP4's trailing
    // moov atom without downloading the whole file.
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        return res.end();
      }

      let start = match[1] ? parseInt(match[1], 10) : null;
      let end = match[2] ? parseInt(match[2], 10) : null;

      if (start === null) {
        const suffixLength = end;
        start = Math.max(0, stats.size - suffixLength);
        end = stats.size - 1;
      } else if (end === null || end >= stats.size) {
        end = stats.size - 1;
      }

      if (start > end || start >= stats.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        return res.end();
      }

      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': cacheControl
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl
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

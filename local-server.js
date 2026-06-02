const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4173;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function logDebug(hypothesisId, location, message, data) {
  // #region agent log
  fetch('http://127.0.0.1:7375/ingest/56863a4b-3411-4780-a3c6-0eba6e03032f', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '964872',
    },
    body: JSON.stringify({
      sessionId: '964872',
      runId: 'site-access-pre-fix',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const route = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(process.cwd(), route);

  // #region agent log
  logDebug('S-H2', 'local-server.js:44', 'incoming request', {
    method: req.method,
    route,
    cwd: process.cwd(),
  });
  // #endregion

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // #region agent log
      logDebug('S-H3', 'local-server.js:53', 'file read failed', {
        route,
        filePath,
        code: err.code || 'UNKNOWN',
      });
      // #endregion
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'text/plain; charset=utf-8');
    res.statusCode = 200;
    res.end(data);
  });
});

server.on('listening', () => {
  const addr = server.address();
  // #region agent log
  logDebug('S-H1', 'local-server.js:73', 'server listening', {
    host: typeof addr === 'object' ? addr.address : HOST,
    port: typeof addr === 'object' ? addr.port : PORT,
    cwd: process.cwd(),
  });
  // #endregion
  console.log(`LOCAL_SERVER_READY http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  // #region agent log
  logDebug('S-H4', 'local-server.js:86', 'server error', {
    code: err.code || 'UNKNOWN',
    message: err.message || 'unknown error',
  });
  // #endregion
  console.error('LOCAL_SERVER_ERROR', err.code || err.message);
});

server.listen(PORT, HOST);

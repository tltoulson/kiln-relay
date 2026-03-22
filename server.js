require('dotenv').config();

const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

// --- Config ---
const PORT = parseInt(process.env.PORT || '80', 10);

const LOG_ENABLED = process.env.LOG_ENABLED === 'true';
const LOG_FILE = '/logs/kiln.log';

const FORWARD_ENABLED = process.env.FORWARD_ENABLED === 'true';
const FORWARD_URL = process.env.FORWARD_URL || '';
const FORWARD_USERNAME = process.env.FORWARD_USERNAME || '';
const FORWARD_PASSWORD = process.env.FORWARD_PASSWORD || '';

// --- Logging ---
function logRequest(entry) {
  if (!LOG_ENABLED) return;
  const line = JSON.stringify(entry) + '\n';
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) console.error('[log] Failed to write to log file:', err.message);
  });
}

// --- Forwarding ---
function forwardRequest(method, path, incomingHeaders, body) {
  if (!FORWARD_ENABLED || !FORWARD_URL) return;

  let targetUrl;
  try {
    targetUrl = new URL(path, FORWARD_URL);
  } catch (err) {
    console.error('[forward] Invalid FORWARD_URL:', err.message);
    return;
  }

  const isHttps = targetUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  // Copy headers, replace Host with the target host
  const headers = Object.assign({}, incomingHeaders, { host: targetUrl.host });

  // Inject basic auth if credentials are configured
  if (FORWARD_USERNAME || FORWARD_PASSWORD) {
    const encoded = Buffer.from(`${FORWARD_USERNAME}:${FORWARD_PASSWORD}`).toString('base64');
    headers['authorization'] = `Basic ${encoded}`;
  }

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + (targetUrl.search || ''),
    method,
    headers,
  };

  const req = lib.request(options, (res) => {
    // Drain the response body so the socket can be reused
    res.resume();
    console.log(`[forward] ${method} ${path} -> ${res.statusCode}`);
  });

  req.on('error', (err) => {
    console.error('[forward] Request error:', err.message);
  });

  if (body && body.length > 0) req.write(body);
  req.end();
}

// --- Server ---
const server = http.createServer((req, res) => {
  const chunks = [];

  req.on('data', (chunk) => chunks.push(chunk));

  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const entry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: body.toString('utf8'),
    };

    console.log(`[recv] ${entry.timestamp} ${req.method} ${req.url}`);

    logRequest(entry);
    forwardRequest(req.method, req.url, req.headers, body);

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  req.on('error', (err) => {
    console.error('[recv] Request error:', err.message);
    res.writeHead(400);
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(`kiln-relay listening on port ${PORT}`);
  console.log(`  logging:    ${LOG_ENABLED ? `enabled -> ${LOG_FILE}` : 'disabled'}`);
  console.log(`  forwarding: ${FORWARD_ENABLED ? `enabled -> ${FORWARD_URL}` : 'disabled'}`);
});

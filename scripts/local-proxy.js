#!/usr/bin/env node
const http = require('http');
const https = require('https');
const { URL } = require('url');

const port = process.env.PORT || 4323;

function proxyRequest(req, res) {
  try {
    const fullUrl = new URL(req.url, `http://${req.headers.host}`);
    const target = fullUrl.searchParams.get('url');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url query parameter');
      return;
    }

    const targetUrl = new URL(target);
    const client = targetUrl.protocol === 'https:' ? https : http;

    const headers = {};
    if (req.headers.range) headers.range = req.headers.range;
    // Forward If-Range and others commonly used for ranges
    if (req.headers['if-range']) headers['if-range'] = req.headers['if-range'];

    const opts = {
      method: 'GET',
      headers,
    };

    const upstream = client.request(targetUrl, opts, (upRes) => {
      // Prepare headers to send back to browser
      const outHeaders = Object.assign({}, upRes.headers);

      // Ensure CORS for WebAudio/fetch
      outHeaders['access-control-allow-origin'] = '*';
      outHeaders['access-control-expose-headers'] = 'Accept-Ranges,Content-Range,Content-Length,Content-Type';
      outHeaders['access-control-allow-headers'] = 'Range,Content-Type';

      // Prefer correct video content-type when possible
      const disposition = (upRes.headers['content-disposition'] || '').toLowerCase();
      if ((upRes.headers['content-type'] || '').includes('application/octet-stream') || disposition.includes('.mp4')) {
        outHeaders['content-type'] = 'video/mp4';
      }

      res.writeHead(upRes.statusCode || 200, outHeaders);
      upRes.pipe(res);
    });

    upstream.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Upstream request failed: ' + String(err));
    });

    upstream.end();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + String(err));
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Range,Content-Type',
    });
    res.end();
    return;
  }
  proxyRequest(req, res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local proxy listening on http://127.0.0.1:${port}`);
});

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 5173;
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000';

// Headers for all responses
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Prevent Cloudflare and browser from caching HTML responses
  if (!req.path.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  next();
});

// Proxy /api and /ws requests to the backend (must be before static files)
const apiProxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true,
  pathRewrite: (p, req) => req.originalUrl,
});

app.use(['/api', '/ws'], apiProxy);

// Serve static files from dist
app.use(express.static(path.join(__dirname, 'dist')));

// Return 404 for missing assets (don't serve index.html for .js/.css/.map files)
app.use('/assets', (req, res) => {
  res.status(404).end();
});

// SPA fallback - serve index.html for all other routes (client-side routing)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server running on port ${PORT}`);
  console.log(`API proxy -> ${BACKEND_URL}`);
});

// Explicitly handle WebSocket upgrade events for reliable WS proxying
// (http-proxy-middleware v3 requires this for stable WebSocket connections)
server.on('upgrade', apiProxy.upgrade);

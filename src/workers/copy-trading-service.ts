/**
 * Copy Trading Worker Entry Point
 *
 * Includes a minimal HTTP health endpoint for Railway healthchecks
 * since this runs as a standalone service without Next.js.
 */

import http from 'http';

// Minimal health server for Railway
const PORT = parseInt(process.env.PORT || '3000', 10);
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"status":"ok","service":"copy-trading-worker"}');
}).listen(PORT, () => {
  console.log(`[copy-worker] Health endpoint listening on port ${PORT}`);
});

// Start the actual worker
import('./copy-trading').catch((err) => {
  console.error('[copy-worker] Fatal error:', err);
  process.exit(1);
});

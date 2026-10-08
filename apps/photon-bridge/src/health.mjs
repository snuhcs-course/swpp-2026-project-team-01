// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import { createServer } from 'node:http';

export function startHealthServer(bridge, port, heartbeatStaleMs) {
  const server = createServer((request, response) => {
    const health = bridge.health;
    const heartbeatFresh = !health.lastHeartbeatAt ||
      Date.now() - Date.parse(health.lastHeartbeatAt) <= heartbeatStaleMs;
    const ready = health.ready && heartbeatFresh;
    const isReady = request.url === '/ready';
    if (request.method !== 'GET' || !['/health', '/ready'].includes(request.url)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(isReady && !ready ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(isReady ? { ready } : { live: health.live }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

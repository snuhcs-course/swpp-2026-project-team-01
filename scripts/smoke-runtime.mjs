import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Tests built production servers without credentials or a model call. Keep the
// deny-all expectation until application-owned session authorization replaces it.
const children = [];
async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function start(args, port, health) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port),
      HOST: '127.0.0.1', OPENAI_MODEL: 'gpt-6-luna', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let log = '';
  child.stdout.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
  child.stderr.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, `Server exited: ${log}`);
    try {
      const response = await fetch(origin + health, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return origin;
    } catch { /* startup is bounded below */ }
    await delay(100);
  }
  throw new Error(`Server did not become healthy: ${log}`);
}
try {
  const web = await start(['node_modules/next/dist/bin/next', 'start', 'apps/web'], await unusedPort(), '/api/health');
  const health = await fetch(`${web}/api/health`);
  assert.deepEqual(await health.json(), { service: 'find-me-a-time', status: 'reachable', releaseReady: false });
  assert.match(health.headers.get('cache-control'), /no-store/);
  const page = await fetch(web);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('<title>Find Me a Time</title>'), 'Web service serves the application');

  const eve = await start(['.output/server/index.mjs'], await unusedPort(), '/eve/v1/health');
  for (const path of ['/session', '/session/test', ...['cancel', 'compact', 'clear', 'reset'].map((action) => `/session/test/${action}`)]) {
    const response = await fetch(`${eve}/eve/v1${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized smoke test' }),
    });
    assert.equal(response.status, 401, `POST ${path} must reject unauthenticated callers`);
  }
  const stream = await fetch(`${eve}/eve/v1/session/test/stream`);
  assert.equal(stream.status, 401);
  console.log('PASS: built web health/page/headers and all seven eve session/stream routes reject anonymous access.');
} finally {
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null) return;
    const closed = once(child, 'close');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await closed;
    clearTimeout(timer);
  }));
}

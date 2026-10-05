import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

test('disabled service boots without provider credentials and shuts down on SIGTERM', { timeout: 15_000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['src/main.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { PATH: process.env.PATH, PHOTON_BRIDGE_ENABLED: 'false', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  const exit = once(child, 'exit');
  let output = '';
  child.stdout.on('data', (value) => { output += value; });
  child.stderr.on('data', (value) => { output += value; });
  try {
    let response;
    // SDK module initialization can exceed two seconds under parallel builds.
    // Bound the actual deadline and fail immediately if the process exits.
    const readinessDeadline = performance.now() + 10_000;
    while (performance.now() < readinessDeadline) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, `service exited before readiness: ${output}`);
      assert.equal(child.signalCode, null, `service terminated before readiness: ${output}`);
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(500),
        });
        break;
      } catch {}
      await sleep(25);
    }
    assert.equal(response?.status, 200, `service readiness deadline exceeded: ${output}`);
    assert.deepEqual(await response.json(), { live: true });
    assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 503);
    child.kill('SIGTERM');
    const result = await Promise.race([exit, sleep(2_000).then(() => { throw new Error('shutdown_timeout'); })]);
    assert.deepEqual(result, [0, null]);
    assert.equal(output, '');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

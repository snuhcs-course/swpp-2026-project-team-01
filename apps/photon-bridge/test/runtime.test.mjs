import assert from 'node:assert/strict';
import test from 'node:test';
import { startHealthServer } from '../src/health.mjs';
import { runStreamLoop, startHeartbeatWatchdog } from '../src/runtime.mjs';

const config = { reconnectMinMs: 5, reconnectMaxMs: 10, heartbeatStaleMs: 30 };

test('backs off and reconnects after both normal EOF and failure', async () => {
  const controller = new AbortController();
  const times = [];
  const logs = [];
  const bridge = { start: async () => {
    times.push(Date.now());
    if (times.length === 1) throw Object.assign(new Error('private body'), { code: 'timeout' });
    if (times.length === 3) controller.abort();
  } };
  await runStreamLoop(bridge, config, controller.signal, (entry) => logs.push(entry));
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 4);
  assert.ok(times[2] - times[1] >= 8);
  assert.deepEqual(logs, [{ event: 'photon_stream_disconnected', code: 'timeout' }]);
});

test('abort wakes a pending reconnect delay', async () => {
  const controller = new AbortController();
  const pending = runStreamLoop({ start: async () => {} },
    { ...config, reconnectMinMs: 60_000 }, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await pending;
});

test('stale heartbeat closes the connection for reconnect', async () => {
  let calls = 0;
  let ready = true;
  const bridge = { get health() { return { ready, lastHeartbeatAt: new Date(0).toISOString() }; },
    reconnect: async () => { calls += 1; ready = false; } };
  const stop = startHeartbeatWatchdog(bridge, 15);
  await new Promise((resolve) => setTimeout(resolve, 30));
  stop();
  assert.equal(calls, 1);
});

test('health distinguishes disabled, fresh subscription and stale heartbeat without exposing secrets', async () => {
  const bridge = { health: { live: true, ready: false, lastHeartbeatAt: null } };
  const server = await startHealthServer(bridge, 0, 1000);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    bridge.health = { live: true, ready: true, lastHeartbeatAt: new Date().toISOString() };
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    bridge.health.lastHeartbeatAt = new Date(0).toISOString();
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    assert.equal((await fetch(`${base}/unknown`)).status, 404);
    assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { live: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

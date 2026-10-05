import { setTimeout as sleep } from 'node:timers/promises';

// A stream ending normally is also a disconnect. Back off in both cases and
// abort delays on shutdown, so an unavailable provider never causes a hot loop.
export async function runStreamLoop(bridge, config, signal, log = () => {}) {
  let delay = config.reconnectMinMs;
  while (!signal.aborted) {
    const startedAt = Date.now();
    try {
      await bridge.start();
    } catch (error) {
      if (!signal.aborted) log({ event: 'photon_stream_disconnected', code:
        /^[a-zA-Z0-9_]{1,100}$/u.test(error?.code ?? '') ? error.code : 'stream_error' });
    }
    if (signal.aborted) return;
    if (Date.now() - startedAt >= config.heartbeatStaleMs) delay = config.reconnectMinMs;
    try {
      await sleep(delay, undefined, { signal });
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    delay = Math.min(delay * 2, config.reconnectMaxMs);
  }
}

export function startHeartbeatWatchdog(bridge, staleMs) {
  let reconnecting = false;
  const timer = setInterval(async () => {
    const health = bridge.health;
    if (!health.ready || !health.lastHeartbeatAt || reconnecting ||
      Date.now() - Date.parse(health.lastHeartbeatAt) <= staleMs) return;
    reconnecting = true;
    try {
      await bridge.reconnect();
    } catch {
      // Readiness remains false; the stream loop owns reconnect failures.
    } finally {
      reconnecting = false;
    }
  }, Math.min(staleMs / 3, 1_000));
  return () => clearInterval(timer);
}

import { createBackendClient } from './backend.mjs';
import { PhotonBridge } from './bridge.mjs';
import { loadConfig } from './config.mjs';
import { startHealthServer } from './health.mjs';
import { createPhotonProvider } from './provider.mjs';
import { runStreamLoop, startHeartbeatWatchdog } from './runtime.mjs';

const config = loadConfig();
const bridge = config.enabled
  ? new PhotonBridge({
      backend: createBackendClient({
        baseUrl: config.backendUrl,
        serviceToken: config.serviceToken,
        timeoutMs: config.operationTimeoutMs,
      }),
      providerFactory: (onHeartbeat) => createPhotonProvider({
        projectId: config.projectId,
        projectSecret: config.projectSecret,
        timeoutMs: config.operationTimeoutMs,
        onHeartbeat,
      }),
    })
  : { health: { live: true, ready: false, lastHeartbeatAt: null }, stop: async () => {} };
const healthServer = await startHealthServer(bridge, config.port, config.heartbeatStaleMs);
const controller = new AbortController();
let stopWatchdog = () => {};
let shutdownPromise;
const shutdown = () => shutdownPromise ??= (async () => {
  controller.abort();
  stopWatchdog();
  await bridge.stop();
  await new Promise((resolve) => healthServer.close(resolve));
})();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);

if (config.enabled) {
  bridge.startOutboundPolling(config.outboundPollMs);
  stopWatchdog = startHeartbeatWatchdog(bridge, config.heartbeatStaleMs);
  try {
    await runStreamLoop(bridge, config, controller.signal, (entry) => {
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    });
  } finally {
    await shutdown();
  }
} else {
  await new Promise((resolve) => controller.signal.addEventListener('abort', resolve, { once: true }));
  await shutdown();
}

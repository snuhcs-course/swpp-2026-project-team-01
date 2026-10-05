const required = (env, name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
};

const integer = (env, name, fallback, minimum, maximum) => {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid_environment:${name}`);
  }
  return value;
};

const httpUrl = (env, name) => {
  const value = new URL(required(env, name));
  if (!['http:', 'https:'].includes(value.protocol) ||
    (value.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(value.hostname)) ||
    value.username || value.password) {
    throw new Error(`invalid_environment:${name}`);
  }
  return value;
};

const boolean = (env, name, fallback = false) => {
  const value = env[name];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`invalid_environment:${name}`);
};

export function loadConfig(env = process.env) {
  const enabled = boolean(env, 'PHOTON_BRIDGE_ENABLED');
  const base = {
    enabled,
    port: integer(env, 'PORT', 8080, 1, 65_535),
    operationTimeoutMs: integer(env, 'FMAT_PHOTON_OPERATION_TIMEOUT_MS', 8_000, 1_000, 30_000),
    outboundPollMs: integer(env, 'FMAT_PHOTON_OUTBOUND_POLL_MS', 1_000, 250, 30_000),
    heartbeatStaleMs: integer(env, 'FMAT_PHOTON_HEARTBEAT_STALE_MS', 90_000, 30_000, 300_000),
    reconnectMinMs: integer(env, 'FMAT_PHOTON_RECONNECT_MIN_MS', 500, 100, 30_000),
    reconnectMaxMs: integer(env, 'FMAT_PHOTON_RECONNECT_MAX_MS', 30_000, 1_000, 300_000),
  };
  if (!enabled) return Object.freeze(base);
  const backendUrl = httpUrl(env, 'FMAT_API_URL');
  const serviceToken = required(env, 'PHOTON_BRIDGE_SECRET');
  if ([env.WORKER_SECRET, env.SUPABASE_SECRET_KEY, env.PHOTON_PROJECT_SECRET].some(
    (value) => value && value === serviceToken)) throw new Error('shared_environment:PHOTON_BRIDGE_SECRET');
  if (serviceToken.length < 32) throw new Error('invalid_environment:PHOTON_BRIDGE_SECRET');
  if (base.reconnectMaxMs < base.reconnectMinMs) throw new Error('invalid_environment:FMAT_PHOTON_RECONNECT_MAX_MS');
  return Object.freeze({
    ...base,
    backendUrl,
    serviceToken,
    projectId: required(env, 'PHOTON_PROJECT_ID'),
    projectSecret: required(env, 'PHOTON_PROJECT_SECRET'),
  });
}

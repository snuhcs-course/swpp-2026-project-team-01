import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.mjs';

test('defaults disabled without requiring credentials', () => {
  const config = loadConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.port, 8080);
  assert.equal(config.projectSecret, undefined);
});

test('requires every secret and endpoint when enabled', () => {
  assert.throws(
    () => loadConfig({ PHOTON_BRIDGE_ENABLED: 'true' }),
    /missing_environment:FMAT_API_URL/,
  );
  const config = loadConfig({
    PHOTON_BRIDGE_ENABLED: 'true',
    FMAT_API_URL: 'https://api.example.test/functions/v1/api/',
    PHOTON_BRIDGE_SECRET: 'a'.repeat(32),
    PHOTON_PROJECT_ID: 'project-id',
    PHOTON_PROJECT_SECRET: 'project-secret',
  });
  assert.equal(config.enabled, true);
  assert.equal(config.backendUrl.href, 'https://api.example.test/functions/v1/api/');
});

test('rejects short bridge secrets and invalid runtime bounds', () => {
  const enabled = { PHOTON_BRIDGE_ENABLED: 'true', FMAT_API_URL: 'https://api.example.test/',
    PHOTON_BRIDGE_SECRET: 'short', PHOTON_PROJECT_ID: 'project', PHOTON_PROJECT_SECRET: 'secret' };
  assert.throws(() => loadConfig(enabled), /invalid_environment:PHOTON_BRIDGE_SECRET/);
  assert.throws(() => loadConfig({ PORT: '0' }), /invalid_environment:PORT/);
  assert.throws(() => loadConfig({ PHOTON_BRIDGE_ENABLED: 'yes' }), /invalid_environment/);
  assert.throws(() => loadConfig({ ...enabled, PHOTON_BRIDGE_SECRET: 'a'.repeat(32),
    FMAT_PHOTON_RECONNECT_MIN_MS: '2000', FMAT_PHOTON_RECONNECT_MAX_MS: '1000' }),
  /invalid_environment:FMAT_PHOTON_RECONNECT_MAX_MS/);
});

test('rejects shared secrets and transport of bridge secrets over remote plain HTTP', () => {
  const enabled = { PHOTON_BRIDGE_ENABLED: 'true', FMAT_API_URL: 'https://api.example.test/',
    PHOTON_BRIDGE_SECRET: 'a'.repeat(32), PHOTON_PROJECT_ID: 'project', PHOTON_PROJECT_SECRET: 'secret' };
  assert.throws(() => loadConfig({ ...enabled, WORKER_SECRET: enabled.PHOTON_BRIDGE_SECRET }),
    /shared_environment:PHOTON_BRIDGE_SECRET/);
  assert.throws(() => loadConfig({ ...enabled, FMAT_API_URL: 'http://api.example.test/' }),
    /invalid_environment:FMAT_API_URL/);
  assert.equal(loadConfig({ ...enabled, FMAT_API_URL: 'http://127.0.0.1:8000/' }).enabled, true);
});

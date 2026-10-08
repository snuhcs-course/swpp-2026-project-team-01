// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackendClient } from '../src/backend.mjs';

test('uses the scoped bearer secret and internal setup paths', async () => {
  const requests = [];
  const client = createBackendClient({
    baseUrl: new URL('https://api.example.test/functions/v1/api/'),
    serviceToken: 'bridge-secret',
    fetcher: async (url, init) => {
      requests.push({ url: url.href, init });
      return new Response(JSON.stringify({ lastSequence: 3 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await client.resume();
  assert.equal(
    requests[0].url,
    'https://api.example.test/functions/v1/api/internal/setup/imessage/resume',
  );
  assert.equal(requests[0].init.headers.authorization, 'Bearer bridge-secret');
});

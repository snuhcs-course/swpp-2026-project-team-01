import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireSameOrigin, safeReturnPath } from './http.ts';
import { applicationOrigin } from '../config.ts';
import { ApplicationError, publicError } from '../errors.ts';

test('cookie mutations reject absent, cross-site and different-origin requests', () => {
  const cases: Record<string, string>[] = [{}, { origin: 'https://attacker.test' },
    { origin: 'https://release.findmeatime.com', 'sec-fetch-site': 'cross-site' }];
  for (const headers of cases) {
    assert.throws(() => requireSameOrigin(new Request('https://release.findmeatime.com/api/action', { headers }), 'https://release.findmeatime.com'), ApplicationError);
  }
  requireSameOrigin(new Request('https://release.findmeatime.com/api/action', { headers: { origin: 'https://release.findmeatime.com' } }), 'https://release.findmeatime.com');
});

test('authentication returns only to approved relative workspaces', () => {
  for (const input of ['https://attacker.test', '//attacker.test', '/\\attacker.test', '/api/delete', '/connect/authorize', '/app\n', '/%2f%2fattacker.test']) {
    assert.equal(safeReturnPath(input), '/app');
  }
  assert.equal(safeReturnPath('/booking/abc-123?view=receipt#secret'), '/booking/abc-123?view=receipt');
});

test('origin configuration rejects credentials, paths and insecure remote hosts', () => {
  for (const origin of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?secret=x', 'javascript:alert(1)']) {
    assert.throws(() => applicationOrigin({ APP_ORIGIN: origin }), ApplicationError);
  }
  assert.equal(applicationOrigin({ APP_ORIGIN: 'http://localhost:3000' }), 'http://localhost:3000');
});

test('unknown exceptions cannot expose provider or credential details', () => {
  const result = publicError(new Error('token=secret private calendar meeting'));
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /secret|calendar|token=/);
});

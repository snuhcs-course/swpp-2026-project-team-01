import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, test } from 'node:test';
import { generateInvitationCode, manageInvitation } from './manage-invitations.mjs';

const project = 'abcdefghijklmnopqrst';
const invitationId = '11111111-2222-4333-8444-555555555555';
const fixedNow = Date.parse('2026-10-05T00:00:00.000Z');
const expiresAt = new Date(fixedNow + 7 * 86400000 - 60000).toISOString();
const code = '0123-4567-89AB-CDEF';
const remoteEnv = {
  SUPABASE_PROJECT_REF: project,
  SUPABASE_URL: `https://${project}.supabase.co`,
  SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(30)}`,
  APP_ORIGIN: 'https://findmeatime.com',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_EMAIL_API_TOKEN: 'synthetic-cloudflare-token',
  CLOUDFLARE_EMAIL_FROM: 'no-reply@findmeatime.com',
};
const issueArgs = ['issue', '--project-ref', project, '--operator-id', 'test-operator', '--email', 'Host@Example.com'];
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryReceiptDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'fmat-invitations-'));
  temporaryDirectories.push(directory);
  return { directory, url: pathToFileURL(`${directory}/`) };
}

function options(overrides = {}) {
  const receipt = temporaryReceiptDirectory();
  return {
    argv: issueArgs,
    env: remoteEnv,
    linkedProject: project,
    receiptDirectory: receipt.url,
    now: () => fixedNow,
    makeCode: () => code,
    makeIdempotencyKey: () => 'idempotency-key',
    ...overrides,
  };
}

function rpcResult(init) {
  const request = JSON.parse(init.body);
  assert.equal(request.p_operation, 'invite_issue');
  assert.equal(request.p_input.email, 'host@example.com');
  assert.equal(request.p_input.expiresAt, expiresAt);
  assert.ok(!JSON.stringify(request).includes(code));
  return Response.json({ invitationId, email: 'host@example.com', expiresAt });
}

test('remote issue persists a private receipt before exactly one Cloudflare send', async () => {
  const receipt = temporaryReceiptDirectory();
  const calls = [];
  const result = await manageInvitation(options({
    receiptDirectory: receipt.url,
    fetcher: (url, init) => {
      calls.push(url);
      if (url.includes('/rest/v1/rpc/')) return rpcResult(init);
      const receiptPath = join(receipt.directory, `${invitationId}.json`);
      const beforeSend = JSON.parse(readFileSync(receiptPath, 'utf8'));
      assert.equal(beforeSend.dispatch.status, 'dispatching');
      assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
      assert.equal(statSync(receipt.directory).mode & 0o777, 0o700);
      const message = JSON.parse(init.body);
      assert.equal(message.from, 'no-reply@findmeatime.com');
      assert.deepEqual(message.to, ['host@example.com']);
      assert.match(message.text, /Invitation code: 0123-4567-89AB-CDEF/);
      assert.match(message.text, /valid for up to seven days/);
      assert.match(message.text, /same email address \(host@example\.com\)/);
      assert.match(message.text, /Setup URL: https:\/\/findmeatime\.com\/host\/setup/);
      assert.ok(!message.text.includes(`setup?code=${code}`));
      return Response.json({
        success: true,
        result: { message_id: 'cf-message', delivered: [], queued: ['host@example.com'], permanent_bounces: [], suppressed_recipients: [] },
      });
    },
  }));

  assert.equal(calls.length, 2);
  assert.equal(result.emailDelivery.status, 'sent');
  assert.equal(result.code, code);
  const receiptAfter = JSON.parse(readFileSync(join(receipt.directory, `${invitationId}.json`), 'utf8'));
  assert.equal(receiptAfter.dispatch.status, 'sent');
  assert.equal(receiptAfter.invitation.code, code);
  assert.equal(receiptAfter.sender.from, 'no-reply@findmeatime.com');
});

test('manual remote issue, local issue, and revoke never call Cloudflare', async () => {
  const remoteCalls = [];
  const manual = await manageInvitation(options({
    argv: [...issueArgs, '--no-email'],
    env: { ...remoteEnv, CLOUDFLARE_EMAIL_API_TOKEN: '' },
    fetcher: (url, init) => {
      remoteCalls.push(url);
      return Promise.resolve(rpcResult(init));
    },
  }));
  assert.equal(manual.emailDelivery.status, 'manual');
  assert.equal(remoteCalls.length, 1);

  const localCalls = [];
  const local = await manageInvitation(options({
    argv: ['issue', '--local', '--operator-id', 'local-test', '--email', 'host@example.com'],
    env: {},
    spawn: () => ({ status: 0, stdout: JSON.stringify({
      API_URL: 'http://127.0.0.1:54321',
      SECRET_KEY: `sb_secret_${'y'.repeat(30)}`,
    }) }),
    fetcher: (url, init) => {
      localCalls.push(url);
      return Promise.resolve(rpcResult(init));
    },
  }));
  assert.equal(local.emailDelivery.status, 'manual');
  assert.equal(localCalls.length, 1);

  const revokeCalls = [];
  const revoked = await manageInvitation(options({
    argv: ['revoke', '--project-ref', project, '--operator-id', 'test-operator', '--invitation-id', invitationId],
    env: { ...remoteEnv, CLOUDFLARE_EMAIL_API_TOKEN: '' },
    fetcher: (url) => {
      revokeCalls.push(url);
      return Promise.resolve(Response.json({ ok: true }));
    },
  }));
  assert.deepEqual(revoked, { invitationId, revoked: true });
  assert.equal(revokeCalls.length, 1);
});

test('missing Cloudflare configuration fails before invitation RPC', async () => {
  let calls = 0;
  await assert.rejects(manageInvitation(options({
    env: { ...remoteEnv, CLOUDFLARE_EMAIL_FROM: 'no-reply@mail.findmeatime.com' },
    fetcher: () => { calls += 1; throw new Error('unexpected'); },
  })), /no-reply@findmeatime\.com/);
  assert.equal(calls, 0);
});

test('rejected invitation issue does not send email', async () => {
  let calls = 0;
  await assert.rejects(manageInvitation(options({
    fetcher: () => {
      calls += 1;
      return Promise.resolve(Response.json({ message: 'INVITATION_EXISTS' }, { status: 409 }));
    },
  })), /INVITATION_EXISTS/);
  assert.equal(calls, 1);
});

test('lost and suppressed send outcomes retain the issued code without retrying', async () => {
  for (const mode of ['lost', 'suppressed']) {
    let sendCalls = 0;
    const result = await manageInvitation(options({
      fetcher: (url, init) => {
        if (url.includes('/rest/v1/rpc/')) return rpcResult(init);
        sendCalls += 1;
        if (mode === 'lost') throw new Error('secret transport failure');
        return Response.json({
          success: true,
          result: { delivered: [], queued: [], permanent_bounces: [], suppressed_recipients: ['host@example.com'] },
        });
      },
    }));
    assert.equal(sendCalls, 1);
    assert.equal(result.code, code);
    assert.equal(result.emailDelivery.status, mode === 'lost' ? 'uncertain' : 'rejected');
    assert.ok(!JSON.stringify(result.emailDelivery).includes('secret'));
  }
});

test('receipt failure retains recovery code and prevents send', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fmat-receipt-block-'));
  temporaryDirectories.push(root);
  const blockingPath = join(root, 'not-a-directory');
  writeFileSync(blockingPath, 'blocked');
  let emailCalls = 0;
  const result = await manageInvitation(options({
    receiptDirectory: pathToFileURL(`${blockingPath}/`),
    fetcher: (url, init) => {
      if (url.includes('/rest/v1/rpc/')) return rpcResult(init);
      emailCalls += 1;
      throw new Error('must not send');
    },
  }));
  assert.equal(emailCalls, 0);
  assert.equal(result.code, code);
  assert.deepEqual(result.emailDelivery, { status: 'not-sent', code: 'receipt_write_failed' });
});

test('an existing receipt is never reused for another send', async () => {
  const receipt = temporaryReceiptDirectory();
  mkdirSync(receipt.directory, { recursive: true });
  writeFileSync(join(receipt.directory, `${invitationId}.json`), '{"existing":true}\n', { mode: 0o600 });
  let emailCalls = 0;
  const result = await manageInvitation(options({
    receiptDirectory: receipt.url,
    fetcher: (url, init) => {
      if (url.includes('/rest/v1/rpc/')) return rpcResult(init);
      emailCalls += 1;
      throw new Error('must not resend');
    },
  }));
  assert.equal(emailCalls, 0);
  assert.equal(result.code, code);
  assert.equal(result.emailDelivery.code, 'receipt_write_failed');
  assert.equal(readFileSync(join(receipt.directory, `${invitationId}.json`), 'utf8'), '{"existing":true}\n');
});

test('invitation codes encode 80 random bits as 16 readable characters', () => {
  assert.equal(generateInvitationCode(Buffer.alloc(10)), '0000-0000-0000-0000');
  assert.equal(generateInvitationCode(Buffer.alloc(10, 255)), 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  assert.match(generateInvitationCode(), /^(?:[0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.throws(() => generateInvitationCode(Buffer.alloc(9)), /ten random bytes/);
});

test('invalid generated code fails before invitation issuance', async () => {
  let calls = 0;
  await assert.rejects(manageInvitation(options({
    makeCode: () => '1234',
    fetcher: () => { calls += 1; throw new Error('unexpected'); },
  })), /invalid code/);
  assert.equal(calls, 0);
});

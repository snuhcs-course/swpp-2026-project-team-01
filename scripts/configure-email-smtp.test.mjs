import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureEmailSmtp } from './configure-email-smtp.mjs';

const project = 'abcdefghijklmnopqrst';
const env = {
  SUPABASE_PROJECT_REF: project,
  SUPABASE_URL: `https://${project}.supabase.co`,
  SUPABASE_ACCESS_TOKEN: 'synthetic-management-token',
  CLOUDFLARE_EMAIL_API_TOKEN: 'synthetic-email-token',
  CLOUDFLARE_EMAIL_FROM: 'no-reply@mail.example.com',
};
const options = { env, linkedProject: project };
const unexpected = () => {
  throw new Error('Unexpected network call');
};

test('SMTP preview is local and redacts both credentials', async () => {
  const preview = await configureEmailSmtp({ ...options, fetcher: unexpected });
  assert.equal(preview.mode, 'preview');
  assert.equal(preview.settings.smtp_port, '465');
  assert.equal(preview.settings.smtp_user, 'api_token');
  assert.ok(!JSON.stringify(preview).includes('synthetic-'));
});

test('SMTP setup rejects wrong project, hostile URL, and invalid sender before any request', async () => {
  for (
    const override of [
      { linkedProject: 'wrong' },
      { env: { ...env, SUPABASE_URL: `https://${project}.supabase.co.attacker.invalid` } },
      { env: { ...env, CLOUDFLARE_EMAIL_FROM: 'bad\r\nBcc: other@example.com' } },
      { env: { ...env, CLOUDFLARE_EMAIL_API_TOKEN: '' } },
      { env: { ...env, SUPABASE_ACCESS_TOKEN: '' } },
    ]
  ) {
    await assert.rejects(
      configureEmailSmtp({ ...options, apply: true, ...override, fetcher: unexpected }),
    );
  }
});

test('SMTP apply patches only mail transport and verifies readback', async () => {
  const calls = [];
  let saved = { hook_send_email_enabled: false, mailer_autoconfirm: false };
  const result = await configureEmailSmtp({
    ...options,
    apply: true,
    fetcher: (url, init) => {
      assert.equal(url, `https://api.supabase.com/v1/projects/${project}/config/auth`);
      calls.push(init.method);
      if (init.method === 'PATCH') {
        const body = JSON.parse(init.body);
        assert.equal(body.smtp_pass, env.CLOUDFLARE_EMAIL_API_TOKEN);
        assert.ok(Object.keys(body).every((key) => key.startsWith('smtp_')));
        saved = { ...saved, ...body };
      }
      return Promise.resolve(Response.json(saved));
    },
  });
  assert.deepEqual(calls, ['GET', 'PATCH', 'GET']);
  assert.equal(result.mode, 'applied');
  assert.ok(!JSON.stringify(result).includes('synthetic-'));
});

test('SMTP setup refuses active send hook and detects failed or mismatched responses', async () => {
  for (
    const fetcher of [
      () => Promise.resolve(Response.json({ hook_send_email_enabled: true })),
      () => Promise.resolve(Response.json({ smtp_pass: 'secret' }, { status: 403 })),
      () => Promise.resolve(Response.json({})),
      () => Promise.reject(new Error('secret transport details')),
    ]
  ) {
    await assert.rejects(configureEmailSmtp({ ...options, apply: true, fetcher }), (error) => {
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

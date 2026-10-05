import { createAgentMailEmailSender, createCloudflareEmailSender } from './email.ts';
import { readEnvironment } from '../env.ts';

function cloudflareResponse(result: Record<string, unknown>): Response {
  return Response.json({ success: true, result });
}

Deno.test('Cloudflare send uses frozen identity and accepts delivered recipients', async () => {
  let requestUrl = '';
  let requestHeaders = new Headers();
  let requestBody: Record<string, unknown> = {};
  const fetcher = ((url: string, init: RequestInit) => {
    requestUrl = url;
    requestHeaders = new Headers(init.headers);
    requestBody = JSON.parse(init.body as string);
    return Promise.resolve(cloudflareResponse({
      message_id: 'cloudflare-message',
      delivered: ['requester@example.com'],
      queued: [],
      permanent_bounces: [],
      suppressed_recipients: [],
    }));
  }) as typeof fetch;
  const result = await createCloudflareEmailSender(
    'account',
    'token',
    'sender@findmeatime.com',
    fetcher,
  )({ to: ['requester@example.com'], subject: 'Verify', text: 'Code' });
  if (
    result.kind !== 'sent' || result.reference !== 'cloudflare-message' ||
    requestUrl !== 'https://api.cloudflare.com/client/v4/accounts/account/email/sending/send' ||
    requestHeaders.get('Authorization') !== 'Bearer token' ||
    requestHeaders.has('Idempotency-Key') || requestBody.from !== 'sender@findmeatime.com'
  ) throw new Error('Cloudflare acceptance was not recorded safely');
});

Deno.test('Cloudflare accepts queued recipients and rejects fully bounced recipients', async () => {
  const queued = await createCloudflareEmailSender(
    'account',
    'token',
    'from',
    () =>
      Promise.resolve(cloudflareResponse({
        message_id: 'queued-message',
        delivered: [],
        queued: ['one@example.com'],
        permanent_bounces: [],
        suppressed_recipients: [],
      })),
  )({ to: ['one@example.com'], subject: 'Subject', text: 'Text' });
  const bounced = await createCloudflareEmailSender(
    'account',
    'token',
    'from',
    () =>
      Promise.resolve(cloudflareResponse({
        message_id: 'bounced-message',
        delivered: [],
        queued: [],
        permanent_bounces: ['one@example.com'],
        suppressed_recipients: ['two@example.com'],
      })),
  )({ to: ['one@example.com', 'two@example.com'], subject: 'Subject', text: 'Text' });
  if (queued.kind !== 'sent' || bounced.kind !== 'rejected') {
    throw new Error('Cloudflare recipient outcomes were misclassified');
  }
});

Deno.test('Cloudflare partial recipient acceptance remains uncertain', async () => {
  const result = await createCloudflareEmailSender(
    'account',
    'token',
    'from',
    () =>
      Promise.resolve(cloudflareResponse({
        message_id: 'partial-message',
        delivered: ['one@example.com'],
        queued: [],
        permanent_bounces: [],
        suppressed_recipients: ['two@example.com'],
      })),
  )({
    to: ['one@example.com', 'two@example.com'],
    subject: 'Subject',
    text: 'Text',
  });
  if (result.kind !== 'uncertain' || result.code !== 'email_delivery_partial') {
    throw new Error('Partial Cloudflare delivery was treated as complete');
  }
});

Deno.test('Cloudflare invalid and lost responses remain uncertain', async () => {
  const invalid = await createCloudflareEmailSender(
    'account',
    'token',
    'from',
    () =>
      Promise.resolve(cloudflareResponse({
        delivered: ['one@example.com'],
        queued: [],
        permanent_bounces: [],
        suppressed_recipients: [],
      })),
  )({ to: ['one@example.com'], subject: 'Subject', text: 'Text' });
  const lost = await createCloudflareEmailSender(
    'account',
    'token',
    'from',
    () => Promise.reject(new Error('successful send response lost')),
  )({
    to: ['one@example.com'],
    subject: 'Subject',
    text: 'Text',
  });
  if (
    invalid.kind !== 'uncertain' || invalid.code !== 'email_response_invalid' ||
    lost.kind !== 'uncertain' || lost.code !== 'email_response_lost'
  ) throw new Error('Unsafe Cloudflare response handling');
});

Deno.test('AgentMail send includes stable Idempotency-Key and classifies lost response uncertain', async () => {
  let captured = '';
  const fetcher = ((_url: string, init: RequestInit) => {
    captured = new Headers(init.headers).get('Idempotency-Key') || '';
    return Promise.reject(new Error('successful send response lost'));
  }) as typeof fetch;
  const result = await createAgentMailEmailSender('synthetic', fetcher)(
    'fixture@agentmail.to',
    'fmat-contact-challenge',
    { to: ['requester@example.com'], subject: 'Verify', text: 'Code' },
  );
  if (captured !== 'fmat-contact-challenge' || result.kind !== 'uncertain') {
    throw new Error('Unsafe email write handling');
  }
});

Deno.test('environment reads Cloudflare sender settings while retaining AgentMail settings', () => {
  const values: Record<string, string> = {
    APP_ORIGIN: 'https://findmeatime.com',
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    WORKER_SECRET: 'x'.repeat(32),
    CLOUDFLARE_ACCOUNT_ID: 'account',
    CLOUDFLARE_EMAIL_API_TOKEN: 'email-token',
    CLOUDFLARE_EMAIL_FROM: 'notifications@findmeatime.com',
    AGENTMAIL_API_KEY: 'agentmail-key',
    AGENTMAIL_INBOX_ID: 'agent@agentmail.to',
  };
  const environment = readEnvironment((name) => values[name]);
  if (
    environment.cloudflareAccountId !== 'account' ||
    environment.cloudflareEmailToken !== 'email-token' ||
    environment.cloudflareEmailFrom !== 'notifications@findmeatime.com' ||
    environment.agentmailKey !== 'agentmail-key' ||
    environment.agentmailInboxId !== 'agent@agentmail.to'
  ) throw new Error('Email provider environment was not preserved');
});

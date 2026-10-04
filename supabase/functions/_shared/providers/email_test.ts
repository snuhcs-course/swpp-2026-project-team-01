import { createEmailSender } from './email.ts';
Deno.test('email send includes stable Idempotency-Key and classifies lost response uncertain', async () => {
  let captured = '';
  const fetcher = ((_url: string, init: RequestInit) => {
    captured = new Headers(init.headers).get('Idempotency-Key') || '';
    return Promise.reject(new Error('successful send response lost'));
  }) as typeof fetch;
  const result = await createEmailSender('synthetic', fetcher)(
    'fixture@agentmail.to',
    'fmat-contact-challenge',
    { to: ['requester@example.com'], subject: 'Verify', text: 'Code' },
  );
  if (captured !== 'fmat-contact-challenge' || result.kind !== 'uncertain') {
    throw new Error('Unsafe email write handling');
  }
});

import { deadlineFetcher, providerJson } from './transport.ts';
import { DomainError } from '../errors.ts';
Deno.test('provider test double preserves auth failure and never returns empty data', async () => {
  const fetcher = (() => Promise.resolve(new Response('{}', { status: 401 }))) as typeof fetch;
  try {
    await providerJson('https://provider', {}, fetcher);
    throw new Error('Read unexpectedly passed');
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'reconnect_required') throw error;
  }
});
Deno.test('provider transport classifies malformed success as unavailable', async () => {
  const fetcher = (() => Promise.resolve(new Response('<html>maintenance</html>'))) as typeof fetch;
  try {
    await providerJson('https://provider', {}, fetcher);
    throw new Error('Read unexpectedly passed');
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'provider_unavailable') throw error;
  }
});
Deno.test('evaluation deadline aborts provider read and prevents later calls', async () => {
  let calls = 0;
  const fetcher = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      calls++;
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof fetch;
  const bounded = deadlineFetcher(Date.now() + 15, fetcher);
  let unavailable = false;
  try {
    await providerJson('https://provider', {}, bounded);
  } catch (error) {
    unavailable = error instanceof DomainError && error.code === 'provider_unavailable';
  }
  try {
    await bounded('https://provider');
  } catch { /* already expired */ }
  if (!unavailable || calls !== 1) throw new Error('Evaluation deadline failed');
});

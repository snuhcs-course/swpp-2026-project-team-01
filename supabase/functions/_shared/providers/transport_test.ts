import { providerJson } from './transport.ts';
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

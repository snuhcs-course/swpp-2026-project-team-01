import { DomainError } from '../errors.ts';
export type Fetcher = typeof fetch;
export interface ProviderResponse<T> {
  status: number;
  data: T;
}
/** Transport never converts an authorization or read failure into an empty calendar. */
export async function providerJson<T>(
  url: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<ProviderResponse<T>> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new DomainError('provider_unavailable', 503);
  }
  if ([401, 403].includes(response.status)) throw new DomainError('reconnect_required', 409);
  if (response.status === 429 || response.status >= 500) {
    throw new DomainError('provider_unavailable', 503);
  }
  if (!response.ok) throw new DomainError('provider_rejected', 409);
  try {
    return { status: response.status, data: await response.json() as T };
  } catch {
    throw new DomainError('provider_unavailable', 503);
  }
}

import { requiredEnv } from '../config.ts';
import { ApplicationError } from '../errors.ts';
import type { ErrorCode } from '../../contracts/errors.ts';

export type Fetch = typeof globalThis.fetch;
export function supabaseOrigin(env = process.env): string {
  try {
    const url = new URL(requiredEnv('SUPABASE_URL', env));
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error();
    return url.origin;
  } catch { throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503); }
}

const domainErrors: Record<string, [ErrorCode, number]> = {
  OAUTH_STATE_INVALID: ['OAUTH_STATE_INVALID', 400], RECONNECT_REQUIRED: ['RECONNECT_REQUIRED', 409],
  INSUFFICIENT_SCOPES: ['RECONNECT_REQUIRED', 409], CONSENT_LIMIT: ['CONSENT_LIMIT', 429], CALENDAR_ACCESS_INVALID: ['CALENDAR_ACCESS_INVALID', 400],
  EXPLICIT_CHOICE_CONFLICT: ['EXPLICIT_CHOICE_CONFLICT', 409], HANDLE_UNAVAILABLE: ['HANDLE_UNAVAILABLE', 409],
  UNAUTHORIZED: ['UNAUTHORIZED', 401], FORBIDDEN: ['FORBIDDEN', 403],
  NOT_FOUND: ['NOT_FOUND', 404], HOST_NOT_ADMITTED: ['HOST_NOT_ADMITTED', 403],
  INVALID_INPUT: ['INVALID_INPUT', 400], IDEMPOTENCY_REQUIRED: ['INVALID_INPUT', 400],
  INVITATION_INVALID: ['INVITATION_INVALID', 400],
  IDEMPOTENCY_CONFLICT: ['IDEMPOTENCY_CONFLICT', 409],
  REVISION_CONFLICT: ['STALE_REVISION', 409], PROPOSAL_CONFLICT: ['STALE_REVISION', 409],
  REQUEST_CLOSED: ['NOT_FOUND', 404], REQUEST_EXPIRED: ['NOT_FOUND', 404],
  CONVERSATION_BUSY: ['CONVERSATION_BUSY', 409], CONVERSATION_LIMIT: ['CONVERSATION_LIMIT', 429],
};

export class Database {
  constructor(private readonly env = process.env, private readonly fetcher: Fetch = fetch) {}

  async rpc(name: 'fmat_command' | 'fmat_conversation_access' | 'fmat_conversation_check' | 'fmat_conversation_tool' | 'fmat_runtime_message' | 'fmat_runtime_dispatch' | 'fmat_browser_command' | 'fmat_calendar_consent' | 'fmat_calendar_access' | 'fmat_requester_availability' | 'fmat_host_setup' | 'fmat_calendar_scan', parameters: Record<string, unknown>): Promise<unknown> {
    const origin = supabaseOrigin(this.env);
    const key = requiredEnv('SUPABASE_SECRET_KEY', this.env);
    const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
    // Local Supabase still uses legacy JWT service keys. Modern sb_secret keys
    // belong only in apikey; they are not bearer JWTs.
    if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
    let response: Response;
    try {
      response = await this.fetcher(`${origin}/rest/v1/rpc/${name}`, {
        method: 'POST', headers, body: JSON.stringify(parameters),
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new ApplicationError('PROVIDER_UNAVAILABLE', 503); }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ApplicationError('PROVIDER_UNAVAILABLE', 503); }
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && 'message' in body ? body.message : null;
      const mapped = typeof message === 'string' ? domainErrors[message] : undefined;
      if (mapped) throw new ApplicationError(...mapped);
      // Never forward SQL/provider text or log the request/credential object.
      throw new ApplicationError('PROVIDER_UNAVAILABLE', 503);
    }
    return body;
  }
}

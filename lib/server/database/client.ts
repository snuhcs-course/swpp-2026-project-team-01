import { requiredEnv } from '../config.ts';
import { ApplicationError } from '../errors.ts';
import type { ErrorCode } from '../../contracts/errors.ts';
import {observeDatabaseRejection} from './rejection-observations.ts';

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
  EMAIL_LINK_LIMIT: ['EMAIL_LINK_LIMIT',429], EMAIL_LINK_CONFLICT: ['EMAIL_LINK_CONFLICT',409],
  CONTACT_LIMIT: ['CONTACT_LIMIT', 429],
  LEASE_LOST: ['BOOKING_LEASE_LOST', 409], HOST_BUSY: ['BOOKING_BUSY', 409],
  FEASIBILITY_STALE: ['STALE_REVISION', 409], PROPOSAL_STALE: ['STALE_REVISION', 409],
  BOOKING_UNCERTAIN: ['RECONCILIATION_PENDING', 409],
  CHALLENGE_INVALID: ['CHALLENGE_INVALID', 400], LINK_CONFLICT: ['LINK_CONFLICT', 409], IMESSAGE_LIMIT: ['IMESSAGE_LIMIT', 429],
  CONFIGURATION_UNAVAILABLE: ['CONFIGURATION_UNAVAILABLE', 503],
  OAUTH_STATE_INVALID: ['OAUTH_STATE_INVALID', 400], RECONNECT_REQUIRED: ['RECONNECT_REQUIRED', 409],
  INSUFFICIENT_SCOPES: ['RECONNECT_REQUIRED', 409], CONSENT_LIMIT: ['CONSENT_LIMIT', 429], CALENDAR_ACCESS_INVALID: ['CALENDAR_ACCESS_INVALID', 400],
  EXPLICIT_CHOICE_CONFLICT: ['EXPLICIT_CHOICE_CONFLICT', 409], HANDLE_UNAVAILABLE: ['HANDLE_UNAVAILABLE', 409],
  UNAUTHORIZED: ['UNAUTHORIZED', 401], FORBIDDEN: ['FORBIDDEN', 403],
  CONTACT_NOT_VERIFIED: ['CONTACT_NOT_VERIFIED', 409],
  BOOKING_PENDING: ['RECONCILIATION_PENDING', 409],
  NOT_FOUND: ['NOT_FOUND', 404], HOST_NOT_ADMITTED: ['HOST_NOT_ADMITTED', 403],
  INVALID_INPUT: ['INVALID_INPUT', 400], IDEMPOTENCY_REQUIRED: ['INVALID_INPUT', 400],
  INVITATION_INVALID: ['INVITATION_INVALID', 400],
  IDEMPOTENCY_CONFLICT: ['IDEMPOTENCY_CONFLICT', 409],
  STALE_REVISION: ['STALE_REVISION',409], RECONCILIATION_PENDING: ['RECONCILIATION_PENDING',409],
  REVISION_CONFLICT: ['STALE_REVISION', 409], PROPOSAL_CONFLICT: ['STALE_REVISION', 409],
  REQUEST_CLOSED: ['NOT_FOUND', 404], REQUEST_EXPIRED: ['NOT_FOUND', 404],
  MODEL_LIMIT: ['MODEL_LIMIT', 429],
  CONVERSATION_RATE_LIMIT: ['CONVERSATION_RATE_LIMIT', 429],
  CONVERSATION_BUSY: ['CONVERSATION_BUSY', 409], CONVERSATION_LIMIT: ['CONVERSATION_LIMIT', 429],
};

export class Database {
  constructor(private readonly env = process.env, private readonly fetcher: Fetch = fetch) {}

  async rpc(name: 'fmat_runtime_successor' | 'fmat_photon_contact_snapshot' | 'fmat_photon_contact' | 'fmat_photon_contact_delivery' | 'fmat_rejection_record' | 'fmat_rejection_snapshot' | 'fmat_operational_snapshot' | 'fmat_oauth_intake_handoff' | 'fmat_agent_intake' | 'fmat_conversation_model_reserve' | 'fmat_invitation_delivery' | 'fmat_invitation_operator' | 'fmat_agent_operation' | 'fmat_oauth_grants_read' | 'fmat_oauth_register' | 'fmat_oauth_authorization_start' | 'fmat_oauth_authorization_read' | 'fmat_oauth_intake_read' | 'fmat_oauth_intake_consent' | 'fmat_oauth_intake_revoke' | 'fmat_oauth_consent' | 'fmat_oauth_grant_revoke' | 'fmat_oauth_code_exchange' | 'fmat_oauth_refresh' | 'fmat_oauth_grant_check' | 'fmat_oauth_token_revoke' | 'fmat_requester_email_reply_delivery' | 'fmat_requester_recovery_delivery' | 'fmat_requester_recovery' | 'fmat_requester_email_worker' | 'fmat_requester_email_link' | 'fmat_requester_email_receipt' | 'fmat_agentmail_ingress' | 'fmat_requester_identity' | 'fmat_contact_verification_delivery' | 'fmat_contact_verification' | 'fmat_booking_delivery' | 'fmat_booking_receipt' | 'fmat_booking_worker' | 'fmat_booking_dispatch' | 'fmat_booking_evaluation' | 'fmat_booking_approval' | 'fmat_request_lifecycle' | 'fmat_private_review' | 'fmat_host_requests' | 'fmat_scheduling' | 'fmat_candidate_ranking' | 'fmat_preference_decision' | 'fmat_travel_allowance' | 'fmat_availability_evaluation' | 'fmat_command' | 'fmat_conversation_access' | 'fmat_conversation_check' | 'fmat_conversation_tool' | 'fmat_runtime_message' | 'fmat_runtime_dispatch' | 'fmat_browser_command' | 'fmat_calendar_consent' | 'fmat_calendar_access' | 'fmat_requester_availability' | 'fmat_request_detail_review' | 'fmat_host_revision_review' | 'fmat_host_setup' | 'fmat_calendar_scan' | 'fmat_photon_ingress' | 'fmat_photon_link' | 'fmat_photon_link_delivery' | 'fmat_photon_dispatch' | 'fmat_photon_reply_delivery' | 'fmat_photon_handoff' | 'fmat_photon_handoff_browser' | 'fmat_public_intake', parameters: Record<string, unknown>): Promise<unknown> {
    const origin = supabaseOrigin(this.env);
    const key = requiredEnv('SUPABASE_SECRET_KEY', this.env);
    // Catch a known public-key configuration mistake before making a
    // privileged request. Supabase still validates the configured credential.
    if (key.startsWith('sb_publishable_')) throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503);
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
      if (mapped) {
        await observeDatabaseRejection({name,mappedCode:mapped[0],env:this.env,origin,headers,fetcher:this.fetcher});
        throw new ApplicationError(...mapped);
      }
      // Never forward SQL/provider text or log the request/credential object.
      throw new ApplicationError('PROVIDER_UNAVAILABLE', 503);
    }
    await observeDatabaseRejection({name,body,env:this.env,origin,headers,fetcher:this.fetcher});
    return body;
  }
}

export class DomainError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
const statuses: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_admitted: 403,
  host_not_admitted: 403,
  invitation_invalid: 400,
  oauth_state_invalid: 400,
  insufficient_scopes: 403,
  calendar_access_invalid: 400,
  not_found: 404,
  conflict: 409,
  revision_conflict: 409,
  proposal_conflict: 409,
  request_closed: 409,
  request_expired: 410,
  stale_evaluation: 409,
  booking_pending: 409,
  details_required: 400,
  candidate_invalid: 400,
  contact_invalid: 400,
  contact_required: 409,
  not_feasible: 409,
  stale_revision: 409,
  stale_proposal: 409,
  invalid_state: 409,
  idempotency_conflict: 409,
  invalid_invitation: 400,
  invalid_input: 400,
  invalid_token: 401,
  idempotency_required: 400,
  lease_lost: 409,
  expired: 410,
  invalid_oauth_state: 400,
  invalid_scope: 403,
  calendar_permission: 400,
  provider_unavailable: 503,
  reconnect_required: 409,
  rate_limited: 429,
  delivery_reconciliation_required: 409,
  evaluation_incomplete: 503,
  human_confirmation_required: 400,
  agreement_required: 409,
  contact_not_verified: 409,
  feasibility_stale: 409,
  host_busy: 409,
  calendar_conflict: 409,
  booking_uncertain: 409,
  booking_terminal: 409,
  invalid_provider_evidence: 400,
  job_still_active: 409,
  proposal_stale: 409,
  link_not_found: 404,
  challenge_invalid: 400,
  link_conflict: 409,
  provider_message_conflict: 409,
  outbound_conflict: 409,
  conversation_stale: 409,
  review_stale: 409,
  draft_stale: 409,
  rules_stale: 409,
  inbound_not_found: 404,
  inbound_not_processed: 409,
  inbound_out_of_order: 409,
};
export function databaseError(message: string): DomainError {
  const normalized = message.toLowerCase();
  const code = Object.keys(statuses).find((code) =>
    normalized === code || normalized.startsWith(code + ':')
  );
  return new DomainError(code || 'internal_error', code ? statuses[code] : 500);
}
export function errorResponse(error: unknown, correlationId: string): Response {
  const failure = error instanceof DomainError ? error : new DomainError('internal_error', 500);
  const message = failure.status >= 500
    ? 'The service is temporarily unavailable.'
    : failure.status === 401
    ? 'Please authenticate to continue.'
    : failure.status === 403
    ? 'This action is unavailable.'
    : failure.status === 409
    ? 'The request changed. Refresh and review the current version.'
    : failure.status === 404
    ? 'This resource is unavailable.'
    : 'Please check the request and try again.';
  console.error(
    JSON.stringify({
      event: 'request_error',
      correlationId,
      code: failure.code,
      status: failure.status,
    }),
  );
  return Response.json({ error: { code: failure.code, message, correlationId } }, {
    status: failure.status,
  });
}

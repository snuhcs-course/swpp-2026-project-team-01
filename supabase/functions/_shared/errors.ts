export class DomainError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
const statuses: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_admitted: 403,
  not_found: 404,
  conflict: 409,
  stale_revision: 409,
  stale_proposal: 409,
  invalid_state: 409,
  idempotency_conflict: 409,
  invalid_invitation: 400,
  invalid_input: 400,
  invalid_token: 401,
  provider_unavailable: 503,
  reconnect_required: 409,
  rate_limited: 429,
};
export function databaseError(message: string): DomainError {
  const code = Object.keys(statuses).find((code) =>
    message === code || message.startsWith(code + ':')
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

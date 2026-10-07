import { randomUUID } from 'node:crypto';
import type { ErrorCode } from '../contracts/errors.ts';

const messages: Record<ErrorCode, string> = {
  EXPLICIT_CHOICE_CONFLICT: 'An explicit preference already exists. Ask the host to edit that choice before replacing it.',
  HANDLE_UNAVAILABLE: 'This booking name is already in use. Choose another.',
  CALENDAR_ACCESS_INVALID: 'A calendar choice no longer has the required access. Reload your calendars and choose again.',
  OAUTH_STATE_INVALID: 'This connection link expired or belongs to another browser. Start again from your workspace.',
  RECONNECT_REQUIRED: 'Calendar access could not be confirmed. Reconnect Google and grant the requested permissions.',
  CONSENT_LIMIT: 'Too many connection attempts. Please wait ten minutes before trying again.',
  UNAUTHORIZED: 'Sign in or use your private request link to continue.',
  FORBIDDEN: 'This action is not available for your account.',
  NOT_FOUND: 'This resource is unavailable.',
  INVALID_INPUT: 'Check the supplied details and try again.',
  STALE_REVISION: 'The details changed. Review the current version.',
  IDEMPOTENCY_CONFLICT: 'This action identifier was already used for different details.',
  HOST_NOT_ADMITTED: 'Redeem your host invitation to continue setup.',
  CONFIGURATION_UNAVAILABLE: 'This service is not configured yet.',
  PROVIDER_UNAVAILABLE: 'A connected service is unavailable. Please try again.',
  RECONCILIATION_PENDING: 'The outcome is being checked. Do not submit a replacement.',
  INTERNAL_ERROR: 'The action could not be completed. Please try again.',
  INVITATION_INVALID: 'This invitation cannot be used. Check the code and sign in with the invited email.',
  CONVERSATION_BUSY: 'The previous message is still being processed. Reconnect to see its progress.',
  CONVERSATION_LIMIT: 'This conversation has reached its message limit.',
};
export class ApplicationError extends Error {
  constructor(readonly code: ErrorCode, readonly status = 400) { super(messages[code]); }
}
export function publicError(error: unknown, correlationId = randomUUID()) {
  const known = error instanceof ApplicationError ? error : new ApplicationError('INTERNAL_ERROR', 500);
  return { status: known.status, body: { ok: false as const, error: {
    code: known.code, message: known.message, correlationId,
  } } };
}

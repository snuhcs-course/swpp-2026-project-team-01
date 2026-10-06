import { randomUUID } from 'node:crypto';
import type { ErrorCode } from '../contracts/errors.ts';

const messages: Record<ErrorCode, string> = {
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

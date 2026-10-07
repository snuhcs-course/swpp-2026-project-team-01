import { z } from 'zod';

export const errorCode = z.enum([
  'CHALLENGE_INVALID', 'LINK_CONFLICT', 'IMESSAGE_LIMIT',
  'EXPLICIT_CHOICE_CONFLICT', 'HANDLE_UNAVAILABLE', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT', 'STALE_REVISION',
  'IDEMPOTENCY_CONFLICT', 'HOST_NOT_ADMITTED', 'CONFIGURATION_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE', 'RECONCILIATION_PENDING', 'INTERNAL_ERROR',
  'CALENDAR_ACCESS_INVALID', 'OAUTH_STATE_INVALID', 'RECONNECT_REQUIRED', 'CONSENT_LIMIT',
  'INVITATION_INVALID', 'CONVERSATION_BUSY', 'CONVERSATION_LIMIT',
]);
export type ErrorCode = z.infer<typeof errorCode>;
export const errorResponse = z.object({
  ok: z.literal(false),
  error: z.object({ code: errorCode, message: z.string(), correlationId: z.uuid() }),
});

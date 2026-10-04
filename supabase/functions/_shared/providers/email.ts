import type { Fetcher } from './transport.ts';
export interface PreparedEmail {
  to: string[];
  subject: string;
  text: string;
}
export type SendResult = { kind: 'sent'; reference: string } | {
  kind: 'rejected' | 'uncertain';
  code: string;
};
/** AgentMail's send idempotency window is 24h; the durable caller enforces a smaller retry horizon. */
export function createEmailSender(key: string, fetcher: Fetcher = fetch) {
  return async (
    inboxId: string,
    idempotencyKey: string,
    email: PreparedEmail,
  ): Promise<SendResult> => {
    try {
      const response = await fetcher(
        `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(email),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!response.ok) {
        return {
          kind: response.status >= 500 || [409, 429].includes(response.status)
            ? 'uncertain'
            : 'rejected',
          code: `email_http_${response.status}`,
        };
      }
      const data = await response.json();
      return typeof data.message_id === 'string' && data.message_id.length > 0
        ? { kind: 'sent', reference: data.message_id }
        : { kind: 'uncertain', code: 'email_response_invalid' };
    } catch {
      return { kind: 'uncertain', code: 'email_response_lost' };
    }
  };
}

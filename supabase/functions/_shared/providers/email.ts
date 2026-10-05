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
export function createAgentMailEmailSender(key: string, fetcher: Fetcher = fetch) {
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

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

export function createCloudflareEmailSender(
  accountId: string,
  token: string,
  from: string,
  fetcher: Fetcher = fetch,
) {
  return async (email: PreparedEmail): Promise<SendResult> => {
    let response: Response;
    try {
      response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${
          encodeURIComponent(accountId)
        }/email/sending/send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...email, from }),
          signal: AbortSignal.timeout(12000),
        },
      );
    } catch {
      return { kind: 'uncertain', code: 'email_response_lost' };
    }
    if (!response.ok) {
      return {
        kind: response.status >= 500 || [409, 429].includes(response.status)
          ? 'uncertain'
          : 'rejected',
        code: `email_http_${response.status}`,
      };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { kind: 'uncertain', code: 'email_response_invalid' };
    }
    if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
      return { kind: 'uncertain', code: 'email_response_invalid' };
    }
    const result = (data as { result?: unknown }).result;
    if (!result || typeof result !== 'object') {
      return { kind: 'uncertain', code: 'email_response_invalid' };
    }
    const value = result as Record<string, unknown>;
    const delivered = stringArray(value.delivered);
    const queued = stringArray(value.queued);
    const permanentBounces = stringArray(value.permanent_bounces);
    const suppressed = stringArray(value.suppressed_recipients);
    if (!delivered || !queued || !permanentBounces || !suppressed) {
      return { kind: 'uncertain', code: 'email_response_invalid' };
    }

    const intended = new Set(email.to.map((address) => address.toLowerCase()));
    const accepted = new Set([...delivered, ...queued].map((address) => address.toLowerCase()));
    const rejected = new Set(
      [...permanentBounces, ...suppressed].map((address) => address.toLowerCase()),
    );
    if (
      intended.size === 0 ||
      [...accepted, ...rejected].some((address) => !intended.has(address)) ||
      [...accepted].some((address) => rejected.has(address))
    ) {
      return { kind: 'uncertain', code: 'email_response_invalid' };
    }
    const allAccepted = [...intended].every((address) => accepted.has(address));
    if (allAccepted) {
      return typeof value.message_id === 'string' && value.message_id.length > 0
        ? { kind: 'sent', reference: value.message_id }
        : { kind: 'uncertain', code: 'email_response_invalid' };
    }
    const allRejected = [...intended].every((address) => rejected.has(address));
    if (allRejected && accepted.size === 0) {
      return { kind: 'rejected', code: 'email_recipient_rejected' };
    }
    return accepted.size > 0 || rejected.size > 0
      ? { kind: 'uncertain', code: 'email_delivery_partial' }
      : { kind: 'uncertain', code: 'email_response_invalid' };
  };
}

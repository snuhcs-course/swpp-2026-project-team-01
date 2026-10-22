import { CommandError } from "./commands";
import { deploymentEnvironment } from "./deployment";
import type { MessagingTransport } from "./messaging";

// The Cloudflare Email Service adapter (design decision 5): one REST call per
// message, POST {base}/client/v4/accounts/{account}/email/sending/send with the
// account-scoped Email Sending token. The REST response documents no message ID,
// so the evidence is the application dispatch ID the message carries in
// X-Fmat-Dispatch-Id plus Cloudflare listing every recipient as delivered or
// queued; a message ID is kept too if a live response returns one. Cloudflare
// has no idempotency key, so the adapter never retries: a timeout, a lost
// response or a server error is uncertain and the caller must not send again.

export const CLOUDFLARE_API_URL = "https://api.cloudflare.com";
export const CLOUDFLARE_EMAIL_TIMEOUT_MS = 10_000;
export const DISPATCH_ID_HEADER = "X-Fmat-Dispatch-Id";
export const SENDER_NAME = "Find Me a Time";

type Environment = Readonly<Record<string, string | undefined>>;

export type CloudflareEmailConfig = {
  readonly accountId: string;
  readonly apiToken: string;
  readonly baseUrl: string;
  // The sending address on the onboarded domain.
  readonly from: string;
  readonly timeoutMs: number;
};

// CLOUDFLARE_EMAIL_API_URL points tests and local runs at a stand-in; the
// production deployment ignores it and always talks to Cloudflare.
export function cloudflareEmailConfigFromEnvironment(env: Environment = process.env): CloudflareEmailConfig {
  const overridable = deploymentEnvironment(env) !== "production";

  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "",
    apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() ?? "",
    baseUrl: ((overridable && env.CLOUDFLARE_EMAIL_API_URL?.trim()) || CLOUDFLARE_API_URL).replace(/\/+$/, ""),
    from: env.CLOUDFLARE_EMAIL_FROM?.trim() ?? "",
    timeoutMs: CLOUDFLARE_EMAIL_TIMEOUT_MS,
  };
}

// Missing configuration never falls back to another sender or provider.
export function cloudflareEmailConfigured(config: CloudflareEmailConfig) {
  return Boolean(config.accountId && config.apiToken && config.from);
}

// The frozen From header of a new message. A booking confirmation names the
// host instead of the product (email-delivery: booking confirmation message);
// the name is stripped of characters that could break the header.
export function senderHeader(address: string, name: string = SENDER_NAME) {
  const display = name.replace(/[\r\n"<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || SENDER_NAME;
  return `${display} <${address}>`;
}

// A frozen, non-secret attachment, such as the calendar part.
export type EmailAttachment = {
  readonly filename: string;
  readonly type: string;
  // Base64.
  readonly content: string;
};

export type OutgoingEmail = {
  readonly dispatchId: string;
  // A complete From header, frozen when the delivery was recorded.
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string | null;
  readonly attachments?: readonly EmailAttachment[];
};

export type SendOutcome =
  | {
      readonly status: "accepted";
      readonly delivered: readonly string[];
      readonly queued: readonly string[];
      readonly messageId: string | null;
    }
  | {
      readonly status: "rejected";
      readonly reason: "bounced" | "refused";
      readonly httpStatus: number;
      readonly bounced: readonly string[];
    }
  | {
      readonly status: "uncertain";
      readonly reason: "timeout" | "lost_response" | "server_error" | "missing_evidence";
      readonly httpStatus: number | null;
    };

type SendResponse = {
  readonly success?: boolean;
  readonly result?: {
    readonly delivered?: unknown;
    readonly queued?: unknown;
    readonly permanent_bounces?: unknown;
    readonly message_id?: unknown;
    readonly messageId?: unknown;
  } | null;
};

function addresses(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalized(list: readonly string[]) {
  return new Set(list.map((address) => address.trim().toLowerCase()));
}

// Classifies an HTTP response from the send endpoint.
export function classifySendResponse(status: number, body: SendResponse | null, recipients: readonly string[]): SendOutcome {
  if (status >= 500) return { httpStatus: status, reason: "server_error", status: "uncertain" };

  // A refusal (bad request, authentication, rate limit) sent nothing.
  if (status < 200 || status >= 300) return { bounced: [], httpStatus: status, reason: "refused", status: "rejected" };

  // A success status whose body cannot be read may still have been accepted.
  if (!body || typeof body !== "object") return { httpStatus: status, reason: "lost_response", status: "uncertain" };

  if (body.success === false) return { bounced: [], httpStatus: status, reason: "refused", status: "rejected" };

  const delivered = addresses(body.result?.delivered);
  const queued = addresses(body.result?.queued);
  const bounced = addresses(body.result?.permanent_bounces);
  const bouncedSet = normalized(bounced);

  if (recipients.some((recipient) => bouncedSet.has(recipient.trim().toLowerCase()))) {
    return { bounced, httpStatus: status, reason: "bounced", status: "rejected" };
  }

  const accepted = normalized([...delivered, ...queued]);

  if (recipients.length > 0 && recipients.every((recipient) => accepted.has(recipient.trim().toLowerCase()))) {
    const id = body.result?.message_id ?? body.result?.messageId;
    return { delivered, messageId: typeof id === "string" && id ? id : null, queued, status: "accepted" };
  }

  // Success without acceptance evidence for every recipient is never recorded as
  // sent, and the message may have gone out, so it is not sent again either.
  return { httpStatus: status, reason: "missing_evidence", status: "uncertain" };
}

export function cloudflareEmailTransport(
  config: CloudflareEmailConfig,
  fetchImpl: typeof fetch = fetch,
): MessagingTransport<OutgoingEmail, SendOutcome> {
  return {
    endpoint: config.baseUrl,
    async send(message) {
      if (!cloudflareEmailConfigured(config)) {
        throw new CommandError("unavailable_configuration");
      }

      let response: Response;

      try {
        response = await fetchImpl(
          `${config.baseUrl}/client/v4/accounts/${encodeURIComponent(config.accountId)}/email/sending/send`,
          {
            body: JSON.stringify({
              from: message.from,
              headers: { [DISPATCH_ID_HEADER]: message.dispatchId },
              html: message.html,
              subject: message.subject,
              text: message.text,
              to: [...message.to],
              ...(message.replyTo ? { reply_to: message.replyTo } : {}),
              ...(message.attachments?.length
                ? {
                    attachments: message.attachments.map((attachment) => ({
                      content: attachment.content,
                      disposition: "attachment",
                      filename: attachment.filename,
                      type: attachment.type,
                    })),
                  }
                : {}),
            }),
            headers: { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" },
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(config.timeoutMs),
          },
        );
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { httpStatus: null, reason: timedOut ? "timeout" : "lost_response", status: "uncertain" };
      }

      let body: SendResponse | null;

      try {
        body = (await response.json()) as SendResponse;
      } catch {
        body = null;
      }

      return classifySendResponse(response.status, body, message.to);
    },
  };
}

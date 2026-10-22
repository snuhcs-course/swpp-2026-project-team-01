import { createHmac } from "node:crypto";
import { CommandError } from "./commands";
import { deploymentEnvironment } from "./deployment";
import { assertMessagingAdmitted } from "./messaging";
import type { TokenKey } from "./token-encryption";

// The AgentMail adapter (requester-email-channel design 5 and 6): reading one
// received message and replying to it in its thread, with the runtime key's
// message_read and message_send permissions. Every call passes the messaging
// gate toward its own endpoint first, so a preview or a local run aimed at the
// real provider is refused before any network access. A reply carries the
// caller's Idempotency-Key: AgentMail returns the original message for a
// repeated key for 24 hours and refuses the key with other content (409).

export const AGENTMAIL_API_URL = "https://api.agentmail.to";
export const AGENTMAIL_TIMEOUT_MS = 10_000;

type Environment = Readonly<Record<string, string | undefined>>;

export type AgentMailConfig = {
  readonly apiKey: string;
  readonly baseUrl: string;
  // The product inbox, an address (AGENTMAIL_INBOX_ID).
  readonly inboxId: string;
  readonly timeoutMs: number;
};

// AGENTMAIL_API_URL points tests and local runs at a stand-in; the production
// deployment ignores it and always talks to AgentMail.
export function agentMailConfigFromEnvironment(env: Environment = process.env): AgentMailConfig {
  const overridable = deploymentEnvironment(env) !== "production";

  return {
    apiKey: env.AGENTMAIL_API_KEY?.trim() ?? "",
    baseUrl: ((overridable && env.AGENTMAIL_API_URL?.trim()) || AGENTMAIL_API_URL).replace(/\/+$/, ""),
    inboxId: env.AGENTMAIL_INBOX_ID?.trim().toLowerCase() ?? "",
    timeoutMs: AGENTMAIL_TIMEOUT_MS,
  };
}

export function agentMailConfigured(config: AgentMailConfig) {
  return Boolean(config.apiKey && config.inboxId);
}

export type AuthenticationResults = {
  readonly spf?: string;
  readonly dkim?: string;
  readonly dmarc?: string;
  readonly dkim_domain?: string;
  readonly dmarc_domain?: string;
};

// The fields of a received message the channel reads.
export type ReceivedMessage = {
  readonly inbox_id: string;
  readonly thread_id: string;
  readonly message_id: string;
  readonly from: string;
  readonly labels: readonly string[];
  readonly subject?: string | null;
  readonly text?: string | null;
  readonly extracted_text?: string | null;
  readonly in_reply_to?: string | null;
  readonly references?: readonly string[] | null;
  readonly authentication_results?: AuthenticationResults | null;
  readonly headers?: Readonly<Record<string, string>> | null;
};

export type ReadOutcome =
  | { readonly status: "found"; readonly message: ReceivedMessage }
  | { readonly status: "missing" }
  | { readonly status: "unavailable"; readonly httpStatus: number | null };

export type ReplyOutcome =
  | { readonly status: "accepted"; readonly messageId: string; readonly threadId: string | null }
  | { readonly status: "rejected"; readonly httpStatus: number }
  | {
      readonly status: "uncertain";
      readonly reason: "timeout" | "lost_response" | "server_error" | "missing_evidence" | "busy" | "conflict";
      readonly httpStatus: number | null;
    };

export type AgentMailTransport = {
  readonly endpoint: string;
  readonly inboxId: string;
  getMessage(inboxId: string, messageId: string): Promise<ReadOutcome>;
  reply(inboxId: string, messageId: string, text: string, idempotencyKey: string): Promise<ReplyOutcome>;
};

function messagePath(config: AgentMailConfig, inboxId: string, messageId: string) {
  return `${config.baseUrl}/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`;
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function asMessage(body: unknown): ReceivedMessage | null {
  if (!body || typeof body !== "object") return null;
  const message = body as Partial<ReceivedMessage>;

  return typeof message.inbox_id === "string" &&
    typeof message.thread_id === "string" &&
    typeof message.message_id === "string" &&
    typeof message.from === "string"
    ? { ...message, labels: Array.isArray(message.labels) ? message.labels : [] } as ReceivedMessage
    : null;
}

// Classifies an HTTP answer from the reply endpoint. A refusal (bad request,
// authentication, a rejected recipient, a missing message) sent nothing. A 409
// means the key was used with other content: never sent again, never claimed
// sent. A 429 or a server error may follow acceptance only for the server error,
// but both are retried with the same key, which is safe.
export function classifyReplyResponse(status: number, body: unknown): ReplyOutcome {
  if (status === 429) return { httpStatus: status, reason: "busy", status: "uncertain" };
  if (status >= 500) return { httpStatus: status, reason: "server_error", status: "uncertain" };
  if (status === 409) return { httpStatus: status, reason: "conflict", status: "uncertain" };
  if (status < 200 || status >= 300) return { httpStatus: status, status: "rejected" };

  const reply = (body ?? {}) as { message_id?: unknown; thread_id?: unknown };

  return typeof reply.message_id === "string" && reply.message_id
    ? { messageId: reply.message_id, status: "accepted", threadId: typeof reply.thread_id === "string" ? reply.thread_id : null }
    : { httpStatus: status, reason: "missing_evidence", status: "uncertain" };
}

export function agentMailTransport(
  config: AgentMailConfig,
  env: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): AgentMailTransport {
  const authorize = () => {
    assertMessagingAdmitted(config.baseUrl, env);
    if (!agentMailConfigured(config)) throw new CommandError("unavailable_configuration");
    return { authorization: `Bearer ${config.apiKey}` };
  };

  return {
    endpoint: config.baseUrl,
    inboxId: config.inboxId,
    async getMessage(inboxId, messageId) {
      const headers = authorize();
      let response: Response;

      try {
        response = await fetchImpl(messagePath(config, inboxId, messageId), {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch {
        return { httpStatus: null, status: "unavailable" };
      }

      if (response.status === 404) return { status: "missing" };
      if (!response.ok) return { httpStatus: response.status, status: "unavailable" };

      const message = asMessage(await response.json().catch(() => null));
      return message ? { message, status: "found" } : { httpStatus: response.status, status: "unavailable" };
    },
    async reply(inboxId, messageId, text, idempotencyKey) {
      const headers = authorize();
      let response: Response;

      try {
        response = await fetchImpl(`${messagePath(config, inboxId, messageId)}/reply`, {
          body: JSON.stringify({ text }),
          headers: { ...headers, "content-type": "application/json", "idempotency-key": idempotencyKey },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        return { httpStatus: null, reason: isTimeout(error) ? "timeout" : "lost_response", status: "uncertain" };
      }

      let body: unknown = null;

      try {
        body = await response.json();
      } catch {
        if (response.ok) return { httpStatus: response.status, reason: "lost_response", status: "uncertain" };
      }

      return classifyReplyResponse(response.status, body);
    },
  };
}

// ---------------------------------------------------------------------------
// What a message proves (D5)

// The bare address of a From value such as `Display Name <user@example.com>`,
// lower-cased, or null when it is not one address.
export function senderAddress(from: string) {
  const bracketed = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from.trim());
  const address = (bracketed?.[1] ?? from.trim()).toLowerCase();
  return /^[^\s@<>,"]+@[a-z0-9.-]+\.[a-z0-9-]+$/.test(address) ? address : null;
}

// The display name of a From value, without quotes, or null.
export function senderName(from: string) {
  const match = /^\s*"?([^"<>]*?)"?\s*<[^<>]+>\s*$/.exec(from);
  const name = match?.[1]?.replace(/[\r\n]/g, " ").trim();
  return name ? name.slice(0, 200) : null;
}

function domainOf(address: string) {
  return address.slice(address.lastIndexOf("@") + 1);
}

const REFUSED_LABELS = new Set(["unauthenticated", "spam", "blocked"]);

// A message counts only when AgentMail accepted it as legitimate and its
// authentication results speak for the From domain: DMARC passed, or DKIM
// passed with the signing domain equal to the From domain.
export function senderAuthenticated(message: ReceivedMessage) {
  const address = senderAddress(message.from);
  if (!address) return false;
  if (message.labels.some((label) => REFUSED_LABELS.has(label.toLowerCase()))) return false;

  const results = message.authentication_results ?? {};
  const domain = domainOf(address);

  const dmarc = results.dmarc === "pass" && (!results.dmarc_domain || results.dmarc_domain.toLowerCase() === domain);
  return dmarc || (results.dkim === "pass" && results.dkim_domain?.toLowerCase() === domain);
}

// The keyed hash a binding stores instead of the sender address.
export function senderHash(key: TokenKey, address: string) {
  const derived = createHmac("sha256", key.key).update("find-me-a-time/email-sender/v1").digest();
  return createHmac("sha256", derived).update(address.toLowerCase(), "utf8").digest("hex");
}

// Whether the message starts its thread: it answers no earlier message.
export function startsThread(message: ReceivedMessage) {
  return !message.in_reply_to && (message.references?.length ?? 0) === 0;
}

// The message's new text: AgentMail's extraction without quoted history, else
// the plain text.
export function newText(message: ReceivedMessage) {
  return (message.extracted_text?.trim() || message.text?.trim() || "").replace(/\r\n/g, "\n");
}

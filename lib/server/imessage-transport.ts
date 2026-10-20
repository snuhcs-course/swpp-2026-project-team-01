import { gateTransport, type MessagingTransport } from "./messaging";

// The iMessage transport the phone check sends through (host-imessage-linking
// design §4). The Photon adapter waits for the transport spike (tasks 2.1–2.2):
// Photon's REST API has no send endpoint and spectrum-ts holds a gRPC connection,
// so whether a send fits a job run is not known yet. Until then the only
// transport is the provider stand-in the tests run (IMESSAGE_TRANSPORT=standin),
// and with IMESSAGE_TRANSPORT unset the phone check is unavailable.

export type ImessageMessage = {
  // E.164.
  readonly to: string;
  readonly text: string;
};

export type ImessageReceipt = {
  // The provider's direct conversation and line, when it reports them.
  readonly spaceId: string | null;
  readonly line: string | null;
  readonly messageId: string | null;
};

export const IMESSAGE_SEND_FAILURES = [
  "non_imessage_recipient",
  "provider_authentication",
  "provider_rejected",
  // The send began but its result is unknown: the text may have arrived.
  "uncertain",
] as const;
export type ImessageSendFailure = (typeof IMESSAGE_SEND_FAILURES)[number];

export class ImessageSendError extends Error {
  readonly failure: ImessageSendFailure;

  constructor(failure: ImessageSendFailure) {
    super(`The iMessage send failed: ${failure}.`);
    this.name = "ImessageSendError";
    this.failure = failure;
  }
}

export type ImessageTransport = MessagingTransport<ImessageMessage, ImessageReceipt>;

// The variables the phone check needs before it accepts a number.
export const IMESSAGE_TRANSPORT_REQUIRES = ["IMESSAGE_TRANSPORT"] as const;

const SEND_TIMEOUT_MS = 20_000;

// A stand-in that speaks the receipt shape over HTTP: POST {to, text} answers
// {spaceId, line, messageId} or {failure}. A timeout after the request began is
// uncertain, like a provider send whose result was lost.
export function standInTransport(url: string, fetcher: typeof fetch = fetch): ImessageTransport {
  return {
    send: async (message) => {
      let response: Response;

      try {
        response = await fetcher(url, {
          body: JSON.stringify(message),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        throw new ImessageSendError("uncertain");
      }

      const body = (await response.json().catch(() => null)) as
        | { failure?: string; line?: string | null; messageId?: string | null; spaceId?: string | null }
        | null;

      if (!response.ok || !body || body.failure) {
        const failure = IMESSAGE_SEND_FAILURES.find((known) => known === body?.failure);
        throw new ImessageSendError(failure ?? (response.status >= 500 ? "uncertain" : "provider_rejected"));
      }

      return { line: body.line ?? null, messageId: body.messageId ?? null, spaceId: body.spaceId ?? null };
    },
  };
}

// The configured transport behind the messaging-environment gate, or null when
// the phone check is unavailable here.
export function imessageTransportFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ImessageTransport | null {
  if (env.IMESSAGE_TRANSPORT === "standin" && env.IMESSAGE_STANDIN_URL) {
    return gateTransport(standInTransport(env.IMESSAGE_STANDIN_URL), env);
  }

  return null;
}

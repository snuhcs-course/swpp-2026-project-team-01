import { deploymentEnvironment } from "./deployment";
import { gateTransport, type MessagingTransport } from "./messaging";

// The one module that sends iMessages (host-imessage-channel design 1 and 3, D1,
// D9). Production uses Photon's Spectrum SDK, loaded with a dynamic import so
// nothing else depends on its types, with its telemetry off; local runs and tests
// point PHOTON_API_URL at a stand-in that speaks the same outcomes over HTTP
// (production ignores it). Every send passes the messaging gate first, so a
// preview or a local run toward a real endpoint is refused before any network
// access. A send has four outcomes:
//   - accepted: Photon took the message (its ID and the conversation, when known);
//   - rejected: a definitive refusal, such as a recipient not on iMessage;
//   - unavailable: refused before anything was sent (no connection, no client);
//   - uncertain: the send began and its answer was lost or timed out.
// Photon deduplicates its own gRPC retries but offers no idempotency key we can
// check, so the outbox never repeats an uncertain send.

type Environment = Readonly<Record<string, string | undefined>>;

export const SPECTRUM_ENDPOINT = "https://spectrum.photon.codes";
export const SEND_TIMEOUT_MS = 20_000;

export type PhotonRecipient = {
  // The sender identifier (E.164 or an Apple ID email).
  readonly address: string;
  // The direct conversation's opaque ID, when one is known.
  readonly spaceId: string | null;
};

export type PhotonContent = { readonly kind: "text"; readonly text: string } | { readonly kind: "contact_card" };

export type PhotonSendRequest = {
  readonly recipient: PhotonRecipient;
  readonly content: PhotonContent;
  // The outbox row's ID; the stand-in records it, Spectrum has no field for it.
  readonly idempotencyKey: string;
};

export type PhotonRejection = "not_imessage" | "invalid_recipient" | "provider_rejected" | "provider_authentication";

export type PhotonSendResult =
  | { readonly status: "accepted"; readonly messageId: string | null; readonly spaceId: string | null }
  | { readonly status: "rejected"; readonly category: PhotonRejection }
  | { readonly status: "unavailable" }
  | { readonly status: "uncertain" };

export type PhotonTransport = MessagingTransport<PhotonSendRequest, PhotonSendResult>;

export type PhotonConfig = {
  readonly projectId: string;
  readonly projectSecret: string;
  // The stand-in's base URL, honored outside production only.
  readonly apiUrl: string | null;
  // The line's number (PHOTON_LINE_NUMBER), which the card shows and links to.
  readonly lineNumber: string;
};

export function photonConfig(env: Environment = process.env): PhotonConfig {
  return {
    apiUrl: env.PHOTON_API_URL?.trim() || null,
    lineNumber: env.PHOTON_LINE_NUMBER?.trim() ?? "",
    projectId: env.PHOTON_PROJECT_ID?.trim() ?? "",
    projectSecret: env.PHOTON_PROJECT_SECRET?.trim() ?? "",
  };
}

const REJECTIONS: readonly PhotonRejection[] = ["not_imessage", "invalid_recipient", "provider_rejected", "provider_authentication"];

function refusedBeforeSending(error: unknown) {
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

// The loopback stand-in: POST {apiUrl}/messages with the request as JSON and the
// outbox ID as Idempotency-Key; 200 {messageId, spaceId} is accepted, a 4xx
// {category} is rejected, a 5xx or a lost answer is uncertain, and a refused
// connection is unavailable.
export function standInTransport(apiUrl: string, secret: string, fetcher: typeof fetch = fetch): PhotonTransport {
  const endpoint = apiUrl.replace(/\/+$/, "");

  return {
    endpoint,
    async send(request) {
      let response: Response;

      try {
        response = await fetcher(`${endpoint}/messages`, {
          body: JSON.stringify({ content: request.content, recipient: request.recipient }),
          headers: {
            authorization: `Bearer ${secret || "photon_test"}`,
            "content-type": "application/json",
            "idempotency-key": request.idempotencyKey,
          },
          method: "POST",
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch (error) {
        return refusedBeforeSending(error) ? { status: "unavailable" } : { status: "uncertain" };
      }

      const body = (await response.json().catch(() => null)) as
        | { category?: string; messageId?: string | null; spaceId?: string | null }
        | null;

      if (response.ok) {
        return { messageId: body?.messageId ?? null, spaceId: body?.spaceId ?? null, status: "accepted" };
      }

      if (response.status === 401 || response.status === 403) return { category: "provider_authentication", status: "rejected" };
      if (response.status >= 400 && response.status < 500) {
        const category = REJECTIONS.find((known) => known === body?.category) ?? "provider_rejected";
        return { category, status: "rejected" };
      }

      return { status: "uncertain" };
    },
  };
}

function withTimeout<T>(work: Promise<T>, ms: number) {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("The send timed out.")), ms).unref?.()),
  ]);
}

// Photon's Spectrum SDK: a client per send, built from the project credentials,
// which opens the known conversation or a new one for the recipient, sends, and
// stops. Everything before the send itself is unavailable on failure; a failure
// once the send began is uncertain.
export function spectrumTransport(config: Pick<PhotonConfig, "projectId" | "projectSecret">): PhotonTransport {
  return {
    endpoint: SPECTRUM_ENDPOINT,
    async send(request) {
      if (!config.projectId || !config.projectSecret) return { status: "unavailable" };

      let app: Awaited<ReturnType<typeof import("@spectrum-ts/core").Spectrum>>;
      let platform: typeof import("@spectrum-ts/imessage").imessage;

      try {
        const [{ Spectrum }, { imessage }] = await Promise.all([import("@spectrum-ts/core"), import("@spectrum-ts/imessage")]);
        platform = imessage;
        app = await withTimeout(
          Spectrum({ projectId: config.projectId, projectSecret: config.projectSecret, providers: [imessage.config()], telemetry: false }),
          SEND_TIMEOUT_MS,
        );
      } catch {
        return { status: "unavailable" };
      }

      try {
        const instance = platform(app);
        let space: Awaited<ReturnType<typeof instance.space.get>>;

        try {
          space = request.recipient.spaceId
            ? await withTimeout(instance.space.get(request.recipient.spaceId), SEND_TIMEOUT_MS)
            : await withTimeout(instance.space.create(await instance.user(request.recipient.address)), SEND_TIMEOUT_MS);
        } catch {
          // No conversation could be opened, so nothing was sent. The SDK does
          // not tell a bad recipient from a network fault, so the attempt is
          // retried and the outbox fails the message once its attempts are spent.
          return { status: "unavailable" };
        }

        try {
          if (request.content.kind === "contact_card") {
            await withTimeout(space.shareContactCard(), SEND_TIMEOUT_MS);
            return { messageId: null, spaceId: space.id, status: "accepted" };
          }

          const sent = await withTimeout(space.send(request.content.text), SEND_TIMEOUT_MS);
          return { messageId: sent?.id ?? null, spaceId: space.id, status: "accepted" };
        } catch {
          return { status: "uncertain" };
        }
      } finally {
        await app.stop().catch(() => undefined);
      }
    },
  };
}

// The deployment's transport behind the messaging gate: Spectrum in production,
// the stand-in where PHOTON_API_URL is set elsewhere, else Spectrum (which the
// gate refuses outside production).
export function photonTransport(config: PhotonConfig = photonConfig(), env: Environment = process.env): PhotonTransport {
  const transport =
    deploymentEnvironment(env) !== "production" && config.apiUrl
      ? standInTransport(config.apiUrl, config.projectSecret)
      : spectrumTransport(config);
  return gateTransport(transport, env);
}

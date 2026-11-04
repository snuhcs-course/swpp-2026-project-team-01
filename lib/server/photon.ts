import { E164_NUMBER } from "../contracts/imessage";
import type { StoredChannel } from "../contracts/messaging-channel";
import { deploymentEnvironment } from "./deployment";
import { gateTransport, type MessagingTransport } from "./messaging";
import { whatsAppSendFailure } from "./whatsapp";

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
// WhatsApp Business goes through the same module (host-whatsapp-channel design 1
// and 9, D1, D10): the request names its channel, Spectrum's whatsapp_business
// provider sends it in cloud mode with the same project credentials, and Meta's
// refusals map onto the same four outcomes. Only WhatsApp sends templates.

type Environment = Readonly<Record<string, string | undefined>>;

export const SPECTRUM_ENDPOINT = "https://spectrum.photon.codes";
export const SEND_TIMEOUT_MS = 20_000;

export type PhotonRecipient = {
  // The sender identifier (E.164 or an Apple ID email).
  readonly address: string;
  // The direct conversation's opaque ID, when one is known.
  readonly spaceId: string | null;
};

// A WhatsApp reply button (host-whatsapp-channel design 11, D17): an ID we set,
// naming the exact command, and a title of at most 20 characters.
export type ReplyButton = { readonly id: string; readonly title: string };

// The reply buttons a WhatsApp summary carries, at most three, and the short
// question that carries them when the summary is too long for an interactive body.
export type WhatsAppButtons = { readonly prompt: string; readonly items: readonly ReplyButton[] };

// Meta's limits for an interactive message's body and a reply button's title.
export const MAX_INTERACTIVE_BODY = 1_024;
export const MAX_BUTTON_TITLE = 20;
export const MAX_BUTTONS = 3;

export type PhotonContent =
  // Buttons only on WhatsApp, inside the window (the outbox decides).
  | { readonly kind: "text"; readonly text: string; readonly buttons?: WhatsAppButtons }
  | { readonly kind: "contact_card" }
  // Best-effort signals about the host's message messageId: mark it (on iMessage,
  // the conversation) read, add a tapback or reaction, show typing. Never a
  // message of its own.
  | { readonly kind: "signal"; readonly messageId: string | null; readonly typing: boolean; readonly reaction: string | null }
  // A pre-approved WhatsApp template with positional body parameters.
  | { readonly kind: "template"; readonly name: string; readonly languageCode: string; readonly params: readonly string[] };

export type PhotonSendRequest = {
  readonly channel: StoredChannel;
  readonly recipient: PhotonRecipient;
  readonly content: PhotonContent;
  // The outbox row's ID; the stand-in records it, Spectrum has no field for it.
  readonly idempotencyKey: string;
};

export type PhotonRejection =
  | "not_imessage"
  | "invalid_recipient"
  | "provider_rejected"
  | "provider_authentication"
  // WhatsApp (D10): outside the 24-hour window; no WhatsApp account or not deliverable; a template Meta has not approved.
  | "window_closed"
  | "undeliverable"
  | "template_unavailable"
  // Telegram (host-telegram-channel D11): the user blocked or deleted the bot.
  | "blocked";

export type PhotonSendResult =
  | { readonly status: "accepted"; readonly messageId: string | null; readonly spaceId: string | null }
  | { readonly status: "rejected"; readonly category: PhotonRejection }
  // Telegram's 429 names how long to wait before trying again.
  | { readonly status: "unavailable"; readonly retryAfterSeconds?: number | null }
  | { readonly status: "uncertain" };

export type PhotonTransport = MessagingTransport<PhotonSendRequest, PhotonSendResult>;

export type PhotonConfig = {
  readonly projectId: string;
  readonly projectSecret: string;
  // The stand-in's base URL, honored outside production only.
  readonly apiUrl: string | null;
  // The line's number (PHOTON_LINE_NUMBER), which the card shows and links to.
  readonly lineNumber: string;
  // The WhatsApp line's number as digits (PHOTON_WHATSAPP_NUMBER), for the card and wa.me.
  readonly whatsappNumber: string;
};

export function photonConfig(env: Environment = process.env): PhotonConfig {
  return {
    apiUrl: env.PHOTON_API_URL?.trim() || null,
    lineNumber: env.PHOTON_LINE_NUMBER?.trim() ?? "",
    projectId: env.PHOTON_PROJECT_ID?.trim() ?? "",
    projectSecret: env.PHOTON_PROJECT_SECRET?.trim() ?? "",
    whatsappNumber: env.PHOTON_WHATSAPP_NUMBER?.trim().replace(/^\+/, "") ?? "",
  };
}

const REJECTIONS: readonly PhotonRejection[] = [
  "not_imessage",
  "invalid_recipient",
  "provider_rejected",
  "provider_authentication",
  "window_closed",
  "undeliverable",
  "template_unavailable",
];

function refusedBeforeSending(error: unknown) {
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

// The loopback stand-in: POST {apiUrl}/messages (iMessage) or
// {apiUrl}/whatsapp/messages (WhatsApp) with the request as JSON and the outbox
// ID as Idempotency-Key; 200 {messageId, spaceId} is accepted, a 4xx
// {category} is rejected, a 5xx or a lost answer is uncertain, and a refused
// connection is unavailable.
export function standInTransport(apiUrl: string, secret: string, fetcher: typeof fetch = fetch): PhotonTransport {
  const endpoint = apiUrl.replace(/\/+$/, "");

  const post = async (request: PhotonSendRequest, content: PhotonWireContent, idempotencyKey: string): Promise<PhotonSendResult> => {
    let response: Response;

    try {
      response = await fetcher(`${endpoint}${request.channel === "whatsapp" ? "/whatsapp/messages" : "/messages"}`, {
        body: JSON.stringify({ content, recipient: request.recipient }),
        headers: {
          authorization: `Bearer ${secret || "photon_test"}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
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
    // A rate limit refused the send before anything went out (WhatsApp 130429, 131056).
    if (response.status === 429) return { status: "unavailable" };
    if (response.status >= 400 && response.status < 500) {
      const category = REJECTIONS.find((known) => known === body?.category) ?? "provider_rejected";
      return { category, status: "rejected" };
    }

    return { status: "uncertain" };
  };

  return {
    endpoint,
    async send(request) {
      // WhatsApp buttons go out as the parts Spectrum would send, each its own post.
      if (request.channel === "whatsapp" && request.content.kind === "text" && request.content.buttons) {
        const parts = whatsAppButtonParts(request.content.text, request.content.buttons);
        return sendInParts(parts, (part, index) => post(request, part, index === 0 ? request.idempotencyKey : `${request.idempotencyKey}:${index}`));
      }
      return post(request, request.content, request.idempotencyKey);
    },
  };
}

// What goes over the wire: the content, or one part of a WhatsApp summary with
// buttons (the interactive message itself).
export type PhotonWireContent =
  | PhotonContent
  | { readonly kind: "interactive"; readonly body: string; readonly buttons: readonly ReplyButton[] };

type WhatsAppPart = Extract<PhotonWireContent, { kind: "text" } | { kind: "interactive" }>;

// A summary with buttons (design 11): one interactive message when the body
// fits, else the text followed by a short interactive question.
export function whatsAppButtonParts(text: string, buttons: WhatsAppButtons): readonly WhatsAppPart[] {
  const items = buttons.items.slice(0, MAX_BUTTONS);
  if (text.length <= MAX_INTERACTIVE_BODY) return [{ body: text, buttons: items, kind: "interactive" }];
  return [
    { kind: "text", text },
    { body: buttons.prompt, buttons: items, kind: "interactive" },
  ];
}

// Sends the parts in order. The row's answer is the last part's: once the text
// was accepted, a failed button message still leaves the row accepted, since the
// host can type the command, and the provider ID is the interactive message's.
export async function sendInParts<Part>(
  parts: readonly Part[],
  sendOne: (part: Part, index: number) => Promise<PhotonSendResult>,
): Promise<PhotonSendResult> {
  let accepted: PhotonSendResult | null = null;
  for (const [index, part] of parts.entries()) {
    const result = await sendOne(part, index);
    if (result.status !== "accepted") return accepted ?? result;
    accepted = result;
  }
  return accepted ?? { status: "unavailable" };
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
      if (request.channel === "whatsapp") return sendWhatsApp(config, request);
      if (request.content.kind === "template") return { category: "provider_rejected", status: "rejected" };
      // A signal belongs to a conversation the host already wrote in.
      if (request.content.kind === "signal" && !request.recipient.spaceId) return { category: "invalid_recipient", status: "rejected" };

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

          if (request.content.kind === "signal") {
            const { messageId, reaction, typing } = request.content;
            const message = messageId ? await withTimeout(space.getMessage(messageId), SEND_TIMEOUT_MS) : undefined;
            // iMessage marks the whole conversation read; the tapback needs the message itself.
            if (message) await withTimeout(space.read(message), SEND_TIMEOUT_MS);
            if (message && reaction) await withTimeout(message.react(reaction), SEND_TIMEOUT_MS);
            if (typing) await withTimeout(space.startTyping(), SEND_TIMEOUT_MS);
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

// WhatsApp Business through Spectrum's whatsapp_business provider in cloud mode
// (design 1): Photon issues the line's Meta token from the project credentials.
// The space is the contact ID itself (one-to-one only). Before the send, every
// failure is unavailable; once it began, Meta's refusals map as design 9 says
// and anything else is uncertain.
async function sendWhatsApp(config: Pick<PhotonConfig, "projectId" | "projectSecret">, request: PhotonSendRequest): Promise<PhotonSendResult> {
  if (request.content.kind === "contact_card") return { category: "provider_rejected", status: "rejected" };
  // A signal answers one message of the host's (D15, D16).
  if (request.content.kind === "signal" && !request.content.messageId) return { category: "invalid_recipient", status: "rejected" };
  if (request.content.kind === "signal" || (request.content.kind === "text" && request.content.buttons)) {
    return sendWhatsAppDirect(config, request);
  }

  let app: Awaited<ReturnType<typeof import("@spectrum-ts/core").Spectrum>>;
  let provider: typeof import("@spectrum-ts/whatsapp-business");

  try {
    const [{ Spectrum }, loaded] = await Promise.all([import("@spectrum-ts/core"), import("@spectrum-ts/whatsapp-business")]);
    provider = loaded;
    app = await withTimeout(
      Spectrum({
        projectId: config.projectId,
        projectSecret: config.projectSecret,
        providers: [loaded.whatsappBusiness.config()],
        telemetry: false,
      }),
      SEND_TIMEOUT_MS,
    );
  } catch {
    return { status: "unavailable" };
  }

  try {
    const instance = provider.whatsappBusiness(app);
    let space: Awaited<ReturnType<typeof instance.space.create>>;

    try {
      space = await withTimeout(instance.space.create(await instance.user(request.recipient.address)), SEND_TIMEOUT_MS);
    } catch {
      return { status: "unavailable" };
    }

    try {
      const content =
        request.content.kind === "template"
          ? provider.whatsappTemplate({
              bodyParams: [...request.content.params],
              languageCode: request.content.languageCode,
              name: request.content.name,
            })
          : request.content.text;
      const sent = await withTimeout(space.send(content), SEND_TIMEOUT_MS);
      return { messageId: sent?.id ?? null, spaceId: space.id, status: "accepted" };
    } catch (error) {
      return whatsAppSendFailure(error);
    }
  } finally {
    await app.stop().catch(() => undefined);
  }
}

// Read marks, typing, reactions and reply buttons go through the line's own
// client, @photon-ai/whatsapp-business, which Spectrum's provider wraps but does
// not expose (design 11): Spectrum drops typing content, marks read without the
// typing flag, and numbers poll buttons opt_0… in an in-process cache. The client
// is built as the provider builds it in cloud mode: Photon issues the line's
// Meta token from the project credentials (cloud.issueWhatsappBusinessTokens),
// and the first line in the answer is the one the provider sends from.
async function whatsAppLine(config: Pick<PhotonConfig, "projectId" | "projectSecret">) {
  const [{ cloud }, sdk] = await Promise.all([import("@spectrum-ts/core"), import("@photon-ai/whatsapp-business")]);
  const tokens = await withTimeout(cloud.issueWhatsappBusinessTokens(config.projectId, config.projectSecret), SEND_TIMEOUT_MS);
  const [phoneNumberId, accessToken] = Object.entries(tokens.auth)[0] ?? [];
  if (!phoneNumberId || !accessToken) throw new Error("Photon issued no WhatsApp line.");
  return { client: sdk.createClient({ accessToken, appSecret: "", phoneNumberId, timeout: SEND_TIMEOUT_MS }), sdk };
}

async function sendWhatsAppDirect(config: Pick<PhotonConfig, "projectId" | "projectSecret">, request: PhotonSendRequest): Promise<PhotonSendResult> {
  let line: Awaited<ReturnType<typeof whatsAppLine>>;

  try {
    line = await whatsAppLine(config);
  } catch {
    return { status: "unavailable" };
  }

  const { client, sdk } = line;
  const to = request.recipient.address;
  const content = request.content;

  try {
    if (content.kind === "signal") {
      // One call marks the message read and, for a turn, shows typing until the
      // reply arrives or 25 seconds pass; Meta has no separate typing call.
      try {
        await withTimeout(client.messages.markRead(content.messageId!, { typingIndicator: content.typing }), SEND_TIMEOUT_MS);
        if (content.reaction) {
          await withTimeout(client.messages.send({ reaction: { emoji: content.reaction, messageId: content.messageId! }, to }), SEND_TIMEOUT_MS);
        }
        return { messageId: null, spaceId: to, status: "accepted" };
      } catch (error) {
        return whatsAppSendFailure(error);
      }
    }

    if (content.kind !== "text" || !content.buttons) return { category: "provider_rejected", status: "rejected" };

    return await sendInParts(whatsAppButtonParts(content.text, content.buttons), async (part) => {
      try {
        const sent = await withTimeout(
          part.kind === "text"
            ? client.messages.send({ text: part.text, to })
            : client.messages.send({ interactive: sdk.buttons(part.body, ...part.buttons.map((item) => sdk.button(item.id, item.title))), to }),
          SEND_TIMEOUT_MS,
        );
        return { messageId: sent?.messageId ?? null, spaceId: to, status: "accepted" };
      } catch (error) {
        return whatsAppSendFailure(error);
      }
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

// Registering a number as a user of the project (imessage-number-registration
// design 1). On Photon's shared lines only registered users' messages reach the
// project, so every iMessage link attempt registers the number entered first;
// the answer names the shared-pool number assigned to that user, which the link
// screens then address. Photon's create is idempotent on the number, so entering
// it again returns the same user and number. Production calls Spectrum's REST
// API with the project credentials; elsewhere the stand-in answers POST
// {apiUrl}/users the same way. Outcomes:
//   - registered: the user exists and texts lineNumber;
//   - refused: Photon refused the number or the project (full, or a bad number);
//   - unavailable: nothing could be asked or the answer was lost.
export type PhotonRegistration =
  | { readonly status: "registered"; readonly lineNumber: string }
  | { readonly status: "refused" }
  | { readonly status: "unavailable" };

export type PhotonRegistrar = MessagingTransport<string, PhotonRegistration>;

function registrar(endpoint: string, url: string, authorization: string, fetcher: typeof fetch): PhotonRegistrar {
  return {
    endpoint,
    async send(number) {
      let response: Response;

      try {
        response = await fetcher(url, {
          body: JSON.stringify({ phoneNumber: number, type: "shared" }),
          headers: { authorization, "content-type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        return { status: "unavailable" };
      }

      const body = (await response.json().catch(() => null)) as { data?: { assignedPhoneNumber?: unknown } } | null;
      const assigned = body?.data?.assignedPhoneNumber;
      if (response.ok && typeof assigned === "string" && E164_NUMBER.test(assigned)) return { lineNumber: assigned, status: "registered" };
      if (response.status >= 400 && response.status < 500) return { status: "refused" };
      return { status: "unavailable" };
    },
  };
}

export function photonRegistrar(config: PhotonConfig = photonConfig(), env: Environment = process.env, fetcher: typeof fetch = fetch): PhotonRegistrar {
  const local = deploymentEnvironment(env) !== "production" && config.apiUrl;
  const transport = local
    ? registrar(config.apiUrl!.replace(/\/+$/, ""), `${config.apiUrl!.replace(/\/+$/, "")}/users`, `Bearer ${config.projectSecret || "photon_test"}`, fetcher)
    : registrar(
        SPECTRUM_ENDPOINT,
        `${SPECTRUM_ENDPOINT}/projects/${encodeURIComponent(config.projectId)}/users/`,
        `Basic ${Buffer.from(`${config.projectId}:${config.projectSecret}`).toString("base64")}`,
        fetcher,
      );
  return gateTransport(transport, env);
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

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import { IMESSAGE_INBOUND_JOB } from "./imessage-links";
import { publishJob } from "./jobs";

// The Photon webhook receiver (host-imessage-linking design §4). It verifies the
// signature over the raw body as Photon documents it
// (https://photon.codes/docs/webhooks/verifying-signatures): the header is
// "v0=" + lowercase hex HMAC-SHA256 of "v0:<timestamp>:<raw body>" under the
// webhook's signing secret, and a timestamp more than 5 minutes off is refused.
// A verified message is stored, with its processing job, before the 2xx answer,
// so an acknowledged reply survives a restart. Photon delivers at least once and
// dedupes on (webhook id, message id), which is the table's unique key.

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type PhotonWebhookConfig = {
  readonly secret: string;
  // When set, deliveries from any other registered webhook are refused.
  readonly webhookId: string | null;
};

export function photonWebhookConfigFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PhotonWebhookConfig | null {
  const secret = env.PHOTON_WEBHOOK_SECRET?.trim();
  return secret ? { secret, webhookId: env.PHOTON_WEBHOOK_ID?.trim() || null } : null;
}

export function photonSignature(secret: string, timestamp: string, rawBody: string) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

export function verifyPhotonSignature(
  config: PhotonWebhookConfig,
  headers: Headers,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
) {
  const timestamp = headers.get("x-spectrum-timestamp") ?? "";
  const presented = headers.get("x-spectrum-signature") ?? "";

  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  if (config.webhookId && headers.get("x-spectrum-webhook-id") !== config.webhookId) return false;

  const expected = Buffer.from(photonSignature(config.secret, timestamp, rawBody));
  const given = Buffer.from(presented);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const space = z.object({ id: z.string().min(1), phone: z.string().optional(), type: z.string() });

// The `messages` event (https://photon.codes/docs/webhooks/events). Unknown
// fields and other content types are tolerated; only their shape is read.
const messagesEvent = z.object({
  event: z.literal("messages"),
  message: z.object({
    content: z.object({ text: z.string().optional(), type: z.string() }),
    direction: z.string(),
    id: z.string().min(1),
    sender: z.object({ id: z.string().min(1) }),
    space,
    timestamp: z.string().optional(),
  }),
});

function respond(status: number, code: string) {
  return Response.json({ code }, { headers: { "cache-control": "no-store" }, status });
}

export type PhotonWebhookDependencies = {
  readonly config: PhotonWebhookConfig | null;
  readonly db: Database;
  readonly now?: () => number;
};

// POST /api/photon/webhook
export function createPhotonWebhookHandler(load: () => PhotonWebhookDependencies) {
  return async (request: Request) => {
    const deps = load();

    if (!deps.config) return respond(503, "unavailable_configuration");

    // The signature covers the exact bytes, so the body is read once as text.
    const raw = await request.text();

    if (!verifyPhotonSignature(deps.config, request.headers, raw, deps.now?.())) return respond(401, "invalid_signature");

    let body: unknown;

    try {
      body = JSON.parse(raw);
    } catch {
      return respond(400, "invalid_body");
    }

    const parsed = messagesEvent.safeParse(body);

    // Other events, and outbound echoes, are acknowledged and dropped.
    if (!parsed.success || parsed.data.message.direction !== "inbound") return respond(200, "ignored");

    const { message } = parsed.data;
    const webhookId = request.headers.get("x-spectrum-webhook-id") ?? "";
    const sentAt = message.timestamp && !Number.isNaN(Date.parse(message.timestamp)) ? new Date(message.timestamp) : null;

    await deps.db.begin(async (tx) => {
      const [stored] = await tx<{ id: string }[]>`
        insert into app.imessage_inbound_events
          (webhook_id, message_id, sender, space_id, space_type, line, content_type, body, sent_at)
        values (
          ${webhookId}, ${message.id}, ${message.sender.id}, ${message.space.id}, ${message.space.type},
          ${message.space.phone ?? null}, ${message.content.type},
          ${message.content.type === "text" ? (message.content.text ?? "") : null}, ${sentAt}
        )
        on conflict (webhook_id, message_id) do nothing
        returning id
      `;

      if (stored) {
        await publishJob(tx, {
          dedupeKey: `${IMESSAGE_INBOUND_JOB}:${stored.id}`,
          kind: IMESSAGE_INBOUND_JOB,
          payload: { eventId: stored.id },
        });
      }
    });

    return respond(200, "received");
  };
}

import { randomUUID } from "node:crypto";
import { photonSignature } from "../../../lib/server/photon-receiver";

// Signed Photon webhook fixtures (host-imessage-channel design 15): a `messages`
// event shaped as Photon documents it, signed with the documented scheme, so
// tests drive the real receiver without a provider.

export const TEST_WEBHOOK_ID = "11111111-2222-4333-8444-555555555555";
export const TEST_WEBHOOK_SECRET = "whsec_photon_test_secret";
export const TEST_LINE = "+15550001111";

export type MessageFixture = {
  readonly id?: string;
  readonly sender?: string;
  readonly text?: string;
  readonly spaceId?: string;
  readonly spaceType?: "dm" | "group";
  readonly content?: Record<string, unknown>;
  readonly direction?: "inbound" | "outbound";
};

export function newSender() {
  return `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

export function messagesEvent(fixture: MessageFixture = {}) {
  const sender = fixture.sender ?? newSender();
  const space = {
    id: fixture.spaceId ?? (fixture.spaceType === "group" ? `chat${randomUUID().slice(0, 12)}` : `any;-;${sender}`),
    phone: TEST_LINE,
    platform: "imessage",
    type: fixture.spaceType ?? "dm",
  };
  return JSON.stringify({
    event: "messages",
    message: {
      content: fixture.content ?? { text: fixture.text ?? "Hello", type: "text" },
      direction: fixture.direction ?? "inbound",
      id: fixture.id ?? `msg_${randomUUID()}`,
      platform: "imessage",
      sender: { id: sender, platform: "imessage" },
      space,
      timestamp: new Date().toISOString(),
    },
    space,
  });
}

export function signedWebhook(
  body: string,
  options: { readonly secret?: string; readonly webhookId?: string; readonly at?: number; readonly url?: string } = {},
) {
  const timestamp = String(options.at ?? Math.floor(Date.now() / 1000));
  return new Request(options.url ?? "http://localhost/photon/webhook", {
    body,
    headers: {
      "content-type": "application/json",
      "user-agent": "spectrum-webhook/1",
      "x-spectrum-event": "messages",
      "x-spectrum-signature": photonSignature(options.secret ?? TEST_WEBHOOK_SECRET, timestamp, body),
      "x-spectrum-timestamp": timestamp,
      "x-spectrum-webhook-id": options.webhookId ?? TEST_WEBHOOK_ID,
    },
    method: "POST",
  });
}

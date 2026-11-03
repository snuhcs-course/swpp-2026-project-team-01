import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { PhotonContent, PhotonRecipient } from "../../../lib/server/photon";

// A loopback stand-in for Photon's sending side (host-imessage-channel design
// 15), so tests and the browser journey drive the real transport and outbox with
// PHOTON_API_URL pointed here. It records every send with its Idempotency-Key and
// answers accepted with a message ID and the conversation; a send can be told to
// answer a status (a 4xx with a category is a refusal, a 5xx is uncertain) or to
// drop its answer after recording it (uncertain).
// WhatsApp sends (host-whatsapp-channel design 9) go to POST /whatsapp/messages:
// free-form text to a contact whose window was closed is refused as Meta's
// 131047 (422 window_closed); a template is accepted unless templates were made
// unavailable (422 template_unavailable).

export type FakeSend = {
  readonly channel: "imessage" | "whatsapp";
  readonly idempotencyKey: string;
  readonly recipient: PhotonRecipient;
  readonly content: PhotonContent;
  readonly messageId: string;
};

export type FakePhoton = {
  readonly baseUrl: string;
  readonly sends: FakeSend[];
  // The next send is recorded and then answered as given.
  nextSend(behavior: "drop" | { readonly status: number; readonly category?: string }): void;
  sentTo(address: string): FakeSend[];
  // Meta refuses free-form text to this WhatsApp contact (131047) from now on.
  closeWindow(address: string): void;
  // Meta refuses every template (132001).
  templatesUnavailable(value?: boolean): void;
  close(): Promise<void>;
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startFakePhoton(options: { readonly port?: number } = {}): Promise<FakePhoton> {
  const sends: FakeSend[] = [];
  const behaviors: ("drop" | { status: number; category?: string })[] = [];
  let counter = 0;
  const closed = new Set<string>();
  let templatesOff = false;

  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url ?? "/", "http://fake-photon");

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true });
      return;
    }

    // Test control from another process (the browser journey).
    if (request.method === "GET" && url.pathname === "/__sends") {
      json(response, 200, sends);
      return;
    }

    const whatsapp = url.pathname === "/whatsapp/messages";
    if (request.method !== "POST" || (url.pathname !== "/messages" && !whatsapp)) {
      json(response, 404, { error: "not_found" });
      return;
    }

    const body = JSON.parse(raw) as { recipient: PhotonRecipient; content: PhotonContent };
    const behavior = behaviors.shift();
    counter += 1;
    const send: FakeSend = {
      channel: whatsapp ? "whatsapp" : "imessage",
      content: body.content,
      idempotencyKey: String(request.headers["idempotency-key"] ?? ""),
      messageId: `pmsg_${counter}`,
      recipient: body.recipient,
    };

    if (whatsapp && !behavior) {
      if (body.content.kind === "template" && templatesOff) {
        json(response, 422, { category: "template_unavailable" });
        return;
      }
      if (body.content.kind === "text" && closed.has(body.recipient.address)) {
        json(response, 422, { category: "window_closed" });
        return;
      }
    }

    if (behavior && behavior !== "drop") {
      if (behavior.status >= 500) sends.push(send);
      json(response, behavior.status, { category: behavior.category });
      return;
    }

    sends.push(send);

    if (behavior === "drop") {
      request.socket.destroy();
      return;
    }

    json(response, 200, {
      messageId: whatsapp ? `wamid.${counter}` : send.messageId,
      spaceId: body.recipient.spaceId ?? (whatsapp ? body.recipient.address : `any;-;${body.recipient.address}`),
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    closeWindow: (address) => closed.add(address),
    templatesUnavailable: (value = true) => {
      templatesOff = value;
    },
    nextSend: (behavior) => behaviors.push(behavior),
    sends,
    sentTo: (address) => sends.filter((send) => send.recipient.address === address),
  };
}

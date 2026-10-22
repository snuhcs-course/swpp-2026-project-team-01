import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Cloudflare Email Service's REST send endpoint, so tests drive
// the real adapter (and the browser tests the real app, pointed at it with
// CLOUDFLARE_EMAIL_API_URL) without a network call. Every message is recorded,
// with its headers, and answered by the behavior set for its first recipient:
// delivered by default, or queued, a permanent bounce, an HTTP status, a success
// with no recipient evidence, a dropped connection or no answer at all.

export type FakeCloudflareBehavior =
  | "delivered"
  | "queued"
  | "bounce"
  | "missing_evidence"
  | "drop"
  | "hang"
  | { readonly status: number };

export type FakeCloudflareMessage = {
  readonly accountId: string;
  readonly authorization: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly reply_to?: string;
  readonly attachments?: readonly { content: string; disposition: string; filename: string; type: string }[];
};

export type FakeCloudflare = {
  // The base URL to set as CLOUDFLARE_EMAIL_API_URL.
  readonly baseUrl: string;
  readonly messages: FakeCloudflareMessage[];
  setBehavior(recipient: string, behavior: FakeCloudflareBehavior): void;
  messagesTo(recipient: string): FakeCloudflareMessage[];
  close(): Promise<void>;
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startFakeCloudflare(options: { readonly port?: number } = {}): Promise<FakeCloudflare> {
  const behaviors = new Map<string, FakeCloudflareBehavior>();
  const messages: FakeCloudflareMessage[] = [];
  const hanging = new Set<ServerResponse>();

  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url ?? "/", "http://fake-cloudflare");

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true });
      return;
    }

    // Test control: POST /__behavior/:recipient sets a behavior from another process.
    const control = url.pathname.match(/^\/__behavior\/(.+)$/);
    if (request.method === "POST" && control) {
      behaviors.set(decodeURIComponent(control[1]!).toLowerCase(), JSON.parse(raw) as FakeCloudflareBehavior);
      response.writeHead(204).end();
      return;
    }

    // Test control: GET /__messages?to=recipient lists what was sent to a
    // recipient, for a browser test in another process.
    if (request.method === "GET" && url.pathname === "/__messages") {
      const to = (url.searchParams.get("to") ?? "").toLowerCase();
      json(response, 200, messages.filter((message) => message.to.some((entry) => entry.toLowerCase() === to)));
      return;
    }

    const send = url.pathname.match(/^\/client\/v4\/accounts\/([^/]+)\/email\/sending\/send$/);
    if (request.method !== "POST" || !send) {
      json(response, 404, { errors: [{ code: 7003, message: "No route." }], result: null, success: false });
      return;
    }

    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Bearer ")) {
      json(response, 401, { errors: [{ code: 10000, message: "Authentication error" }], result: null, success: false });
      return;
    }

    const body = JSON.parse(raw) as Omit<FakeCloudflareMessage, "accountId" | "authorization"> & { to: string | string[] };
    const to = Array.isArray(body.to) ? body.to : [body.to];
    messages.push({
      accountId: decodeURIComponent(send[1]!),
      authorization,
      from: body.from,
      attachments: body.attachments,
      headers: body.headers ?? {},
      html: body.html,
      reply_to: body.reply_to,
      subject: body.subject,
      text: body.text,
      to,
    });

    const behavior = behaviors.get(to[0]?.toLowerCase() ?? "") ?? "delivered";

    if (behavior === "hang") {
      hanging.add(response);
      return;
    }

    if (behavior === "drop") {
      request.socket.destroy();
      return;
    }

    if (typeof behavior === "object") {
      json(response, behavior.status, { errors: [{ code: behavior.status, message: "Refused" }], result: null, success: false });
      return;
    }

    const result = {
      delivered: behavior === "delivered" ? to : [],
      permanent_bounces: behavior === "bounce" ? to : [],
      queued: behavior === "queued" ? to : [],
    };
    json(response, 200, { errors: [], messages: [], result, success: true });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        for (const response of hanging) response.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    messages,
    messagesTo: (recipient) => messages.filter((message) => message.to.some((to) => to.toLowerCase() === recipient.toLowerCase())),
    setBehavior: (recipient, behavior) => behaviors.set(recipient.toLowerCase(), behavior),
  };
}

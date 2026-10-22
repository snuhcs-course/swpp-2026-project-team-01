import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ReceivedMessage } from "../../../lib/server/agentmail";
import { svixSignature } from "../../../lib/server/svix";

// A stand-in for AgentMail's message API and its webhook deliveries, so tests
// drive the real adapter (and the browser tests the real app, pointed at it with
// AGENTMAIL_API_URL) without a network call. It stores received messages, serves
// GET /v0/inboxes/{inbox}/messages/{message}, and records every reply to
// POST .../reply honoring Idempotency-Key as AgentMail does: a repeated key with
// the same text returns the original message and sends nothing; the same key
// with other text answers 409. A reply can be made to drop its response after
// recording it (a lost response) or to answer an HTTP status.

export type FakeReply = {
  readonly inboxId: string;
  readonly inReplyTo: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly messageId: string;
  readonly threadId: string;
};

export type FakeAgentMail = {
  readonly baseUrl: string;
  readonly replies: FakeReply[];
  // Every reply request, repeated keys included.
  readonly attempts: { readonly idempotencyKey: string; readonly text: string }[];
  addMessage(message: ReceivedMessage): void;
  // The next reply request is recorded and then answered as given.
  nextReply(behavior: "drop" | { readonly status: number }): void;
  repliesIn(threadId: string): FakeReply[];
  close(): Promise<void>;
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startFakeAgentMail(options: { readonly port?: number } = {}): Promise<FakeAgentMail> {
  const messages = new Map<string, ReceivedMessage>();
  const replies: FakeReply[] = [];
  const attempts: { idempotencyKey: string; text: string }[] = [];
  const byKey = new Map<string, FakeReply>();
  const behaviors: ("drop" | { status: number })[] = [];
  const key = (inbox: string, message: string) => `${inbox.toLowerCase()}|${message}`;

  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url ?? "/", "http://fake-agentmail");

    // Test control from another process (the browser tests).
    if (request.method === "POST" && url.pathname === "/__messages") {
      const message = JSON.parse(raw) as ReceivedMessage;
      messages.set(key(message.inbox_id, message.message_id), message);
      response.writeHead(204).end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/__replies") {
      json(response, 200, replies);
      return;
    }

    const match = url.pathname.match(/^\/v0\/inboxes\/([^/]+)\/messages\/([^/]+)(\/reply)?$/);

    if (!match || request.headers.authorization !== "Bearer am_test_key") {
      json(response, match ? 401 : 404, { message: "Not found", name: "NotFoundError" });
      return;
    }

    const inbox = decodeURIComponent(match[1]!);
    const messageId = decodeURIComponent(match[2]!);
    const original = messages.get(key(inbox, messageId));

    if (request.method === "GET" && !match[3]) {
      if (!original) json(response, 404, { message: "Message not found", name: "NotFoundError" });
      else json(response, 200, original);
      return;
    }

    if (request.method !== "POST" || !match[3]) {
      json(response, 405, { message: "Method not allowed", name: "Error" });
      return;
    }

    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    const { text } = JSON.parse(raw) as { text: string };
    attempts.push({ idempotencyKey, text });
    const behavior = behaviors.shift();

    if (behavior && behavior !== "drop") {
      json(response, behavior.status, { message: "Refused", name: "Error" });
      return;
    }

    if (!original) {
      json(response, 404, { message: "Message not found", name: "NotFoundError" });
      return;
    }

    const earlier = idempotencyKey ? byKey.get(idempotencyKey) : undefined;

    if (earlier && earlier.text !== text) {
      json(response, 409, { code: "idempotency_conflict", message: "Key reused", name: "ConflictError" });
      return;
    }

    const sent =
      earlier ??
      ({
        idempotencyKey,
        inReplyTo: messageId,
        inboxId: inbox,
        messageId: `<${randomUUID()}@agentmail.test>`,
        text,
        threadId: original.thread_id,
      } satisfies FakeReply);

    if (!earlier) {
      replies.push(sent);
      if (idempotencyKey) byKey.set(idempotencyKey, sent);
    }

    if (behavior === "drop") {
      response.destroy();
      return;
    }

    json(response, 200, { message_id: sent.messageId, thread_id: sent.threadId });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    attempts,
    addMessage(message) {
      messages.set(key(message.inbox_id, message.message_id), message);
    },
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    nextReply(behavior) {
      behaviors.push(behavior);
    },
    replies,
    repliesIn: (threadId) => replies.filter((entry) => entry.threadId === threadId),
  };
}

export type InboundEmail = {
  readonly from: string;
  readonly subject?: string;
  readonly text: string;
  readonly threadId?: string;
  readonly inReplyTo?: string;
  readonly authenticated?: boolean;
  readonly labels?: readonly string[];
};

// A received message as AgentMail stores it: authenticated by DMARC unless told
// otherwise.
export function receivedMessage(inboxId: string, email: InboundEmail): ReceivedMessage {
  return {
    authentication_results: email.authenticated === false ? { dmarc: "fail" } : { dkim: "pass", dmarc: "pass", spf: "pass" },
    extracted_text: email.text,
    from: email.from,
    in_reply_to: email.inReplyTo ?? null,
    inbox_id: inboxId,
    labels: [...(email.labels ?? ["received"])],
    message_id: `<${randomUUID()}@mail.example.test>`,
    references: email.inReplyTo ? [email.inReplyTo] : [],
    subject: email.subject ?? null,
    text: email.text,
    thread_id: email.threadId ?? `thr_${randomUUID()}`,
  };
}

// The webhook AgentMail sends for a received message, signed for a receiver.
export function webhookRequest(url: string, secret: string, message: ReceivedMessage, eventId = `evt_${randomUUID()}`) {
  const body = JSON.stringify({
    event_id: eventId,
    event_type: "message.received",
    message: { ...message, preview: message.text?.slice(0, 40) },
    thread: { inbox_id: message.inbox_id, thread_id: message.thread_id },
    type: "event",
  });
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  return new Request(url, {
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-signature": `v1,${svixSignature(secret, id, timestamp, body)}`,
      "svix-timestamp": timestamp,
    },
    method: "POST",
  });
}

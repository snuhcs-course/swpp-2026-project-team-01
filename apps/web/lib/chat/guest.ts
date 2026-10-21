import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import { ChatRequestError, type DiscussionStatus } from "./discussion";

// Browser access to a requester's or an anonymous intake's discussion, the
// counterpart of discussion.ts for /app. The browser talks only to the web
// service's application routes (/api/requests/{bookingId} or
// /api/intake/{handle}), which read the agent with an internal bearer; it never
// sees a runtime session ID or calls /eve/v1 itself.

export type GuestDiscussionClient = {
  readStatus(signal?: AbortSignal): Promise<DiscussionStatus>;
  postMessage(
    clientInputId: string,
    message: string,
    extra?: Record<string, unknown>,
  ): Promise<{ inputId?: string; status?: "sent" | "queued" | "recovery_required"; intakeToken?: string }>;
  readEvents(cursor: number, options: { readonly follow: boolean; readonly signal?: AbortSignal }): AsyncGenerator<DiscussionEvent>;
};

export type GuestPostError = ChatRequestError & { readonly intakeToken?: string };

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string; intakeToken?: string };

  if (!response.ok) {
    const error = new ChatRequestError(response.status, body.code ?? "unavailable", body.error ?? "Something went wrong. Try again.");
    throw Object.assign(error, body.intakeToken ? { intakeToken: body.intakeToken } : {});
  }

  return body as T;
}

export async function* readNdjson(response: Response): AsyncGenerator<DiscussionEvent> {
  if (!response.ok || !response.body) {
    await readJson(response);
    throw new ChatRequestError(response.status, "unavailable", "History is unavailable right now.");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    buffer += value ?? "";
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");

    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as DiscussionEvent;
    }

    if (done) return;
  }
}

// A client for one guest discussion under `base`; `headers` is read on every call,
// so an intake token the first message created is sent from then on.
export function guestDiscussionClient(base: string, headers: () => Record<string, string> = () => ({})): GuestDiscussionClient {
  return {
    async postMessage(clientInputId, message, extra = {}) {
      const response = await fetch(`${base}/messages`, {
        body: JSON.stringify({ clientInputId, message, ...extra }),
        headers: { "content-type": "application/json", ...headers() },
        method: "POST",
      });
      return readJson(response);
    },
    async *readEvents(cursor, options) {
      const response = await fetch(`${base}/events?cursor=${cursor}${options.follow ? "&follow=1" : ""}`, {
        cache: "no-store",
        headers: headers(),
        signal: options.signal,
      });
      yield* readNdjson(response);
    },
    async readStatus(signal) {
      const response = await fetch(`${base}/state`, { cache: "no-store", headers: headers(), signal });
      const body = await readJson<{ conversation: DiscussionStatus }>(response);
      return body.conversation;
    },
  };
}

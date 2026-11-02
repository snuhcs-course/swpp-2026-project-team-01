import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import { ChatRequestError, type DiscussionStatus } from "./discussion";

// Browser access to a guest's discussion, the counterpart of discussion.ts for
// /app. The guest writes only on the booking page, once identified
// (guest-flow-completion U8), so everything goes to /api/requests/{bookingId}.
// The browser talks only to the web service's
// application routes, which read the agent with an internal bearer; it never
// sees a runtime session ID or calls /eve/v1 itself.

export type GuestPostOutcome = {
  readonly inputId?: string;
  readonly status?: "sent" | "queued" | "recovery_required";
};

export type GuestDiscussionClient = {
  readStatus(signal?: AbortSignal): Promise<DiscussionStatus>;
  postMessage(clientInputId: string, message: string): Promise<GuestPostOutcome>;
  readEvents(cursor: number, options: { readonly follow: boolean; readonly signal?: AbortSignal }): AsyncGenerator<DiscussionEvent>;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };

  if (!response.ok) {
    throw new ChatRequestError(response.status, body.code ?? "unavailable", body.error ?? "Something went wrong. Try again.");
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

// A client for the guest discussion of one booking link.
export function guestDiscussionClient(bookingId: string): GuestDiscussionClient {
  return {
    async postMessage(clientInputId, message) {
      const response = await fetch(`/api/requests/${bookingId}/messages`, {
        body: JSON.stringify({ clientInputId, message }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return readJson(response);
    },
    async *readEvents(cursor, options) {
      const response = await fetch(`/api/requests/${bookingId}/events?cursor=${cursor}${options.follow ? "&follow=1" : ""}`, {
        cache: "no-store",
        signal: options.signal,
      });
      yield* readNdjson(response);
    },
    async readStatus(signal) {
      const response = await fetch(`/api/requests/${bookingId}/state`, { cache: "no-store", signal });
      const body = await readJson<{ conversation?: DiscussionStatus }>(response);
      if (!body.conversation) throw new ChatRequestError(409, "closed", "This request is closed.");
      return body.conversation;
    },
  };
}

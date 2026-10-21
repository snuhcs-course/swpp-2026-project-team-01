import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import { ChatRequestError, type DiscussionStatus } from "./discussion";

// Browser access to a guest's discussion, the counterpart of discussion.ts for
// /app. One discussion serves the guest from the first message (design decision
// 2): before it, the tab has no booking identifier and the first message goes
// to /api/requests/start with the tab's nonce, which starts the draft request
// and answers its identifier; after it, everything goes to
// /api/requests/{bookingId}. The browser talks only to the web service's
// application routes, which read the agent with an internal bearer; it never
// sees a runtime session ID or calls /eve/v1 itself.

export type GuestPostOutcome = {
  readonly inputId?: string;
  readonly status?: "sent" | "queued" | "recovery_required";
  // The draft's booking identifier, when the message started it.
  readonly bookingId?: string;
};

export type GuestDiscussionClient = {
  readStatus(signal?: AbortSignal): Promise<DiscussionStatus>;
  postMessage(clientInputId: string, message: string, extra?: Record<string, unknown>): Promise<GuestPostOutcome>;
  readEvents(cursor: number, options: { readonly follow: boolean; readonly signal?: AbortSignal }): AsyncGenerator<DiscussionEvent>;
};

// A failed post; bookingId is set when the message started a draft before it failed.
export type GuestPostError = ChatRequestError & { readonly bookingId?: string };

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { bookingId?: string; code?: string; error?: string };

  if (!response.ok) {
    const error = new ChatRequestError(response.status, body.code ?? "unavailable", body.error ?? "Something went wrong. Try again.");
    throw Object.assign(error, body.bookingId ? { bookingId: body.bookingId } : {});
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

export type GuestTarget = {
  // The tab's booking identifier, once the first message started the draft.
  readonly bookingId: string | null;
  // The public page's host handle and the tab's nonce, for the first message.
  readonly handle: string | null;
  readonly nonce: string;
};

const NO_CONVERSATION: DiscussionStatus = { generation: null, pendingInputs: 0, state: "none" };

// A client for the guest discussion `target()` names; it is read on every call,
// so the identifier the first message created is used from then on.
export function guestDiscussionClient(target: () => GuestTarget): GuestDiscussionClient {
  return {
    async postMessage(clientInputId, message, extra = {}) {
      const { bookingId, handle, nonce } = target();
      const response = bookingId
        ? await fetch(`/api/requests/${bookingId}/messages`, {
            body: JSON.stringify({ clientInputId, message }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        : await fetch("/api/requests/start", {
            body: JSON.stringify({ clientInputId, handle, message, nonce, ...extra }),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
      return readJson(response);
    },
    async *readEvents(cursor, options) {
      const { bookingId } = target();
      if (!bookingId) return;
      const response = await fetch(`/api/requests/${bookingId}/events?cursor=${cursor}${options.follow ? "&follow=1" : ""}`, {
        cache: "no-store",
        signal: options.signal,
      });
      yield* readNdjson(response);
    },
    async readStatus(signal) {
      const { bookingId } = target();
      if (!bookingId) return NO_CONVERSATION;
      const response = await fetch(`/api/requests/${bookingId}/state`, { cache: "no-store", signal });
      const body = await readJson<{ conversation?: DiscussionStatus }>(response);
      if (!body.conversation) throw new ChatRequestError(409, "closed", "This request is closed.");
      return body.conversation;
    },
  };
}

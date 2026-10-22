import type { DiscussionEvent } from "@lib/contracts/discussion-events";

// Browser access to the host's discussions: setup, or with `request` the host's
// private review of one request (host-review-and-booking design 2). The browser
// talks only to the web service's /api/chat routes; it never sees a runtime
// session ID or calls /eve/v1 itself.

export type DiscussionStatus = {
  readonly generation: number | null;
  readonly state: "none" | "active" | "failed";
  readonly pendingInputs: number;
};

export class ChatRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ChatRequestError";
    this.code = code;
    this.status = status;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };

  if (!response.ok && response.status !== 409) {
    throw new ChatRequestError(response.status, body.code ?? "unavailable", body.error ?? "Something went wrong. Try again.");
  }

  return body as T;
}

function scoped(path: string, request: string | null | undefined, query: Record<string, string> = {}) {
  const params = new URLSearchParams({ ...query, ...(request ? { request } : {}) });
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export async function readDiscussionStatus(signal?: AbortSignal, request?: string | null) {
  return readJson<DiscussionStatus>(await fetch(scoped("/api/chat/state", request), { cache: "no-store", signal }));
}

export async function postMessage(clientInputId: string, message: string, request?: string | null) {
  const response = await fetch("/api/chat/messages", {
    body: JSON.stringify({ clientInputId, message, ...(request ? { request } : {}) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return readJson<{
    inputId?: string;
    status?: "sent" | "queued" | "recovery_required";
    code?: string;
    error?: string;
  }>(response);
}

export async function postRecovery(observedGeneration: number, request?: string | null) {
  const response = await fetch("/api/chat/recover", {
    body: JSON.stringify({ observedGeneration, ...(request ? { request } : {}) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return readJson<{
    status: "recovered" | "stale" | "not_failed" | "unavailable";
    generation?: number | null;
    // A recovered input is in flight on the successor, so a turn is coming.
    delivered?: boolean;
  }>(
    response,
  );
}

// The discussion's events from a cursor, as NDJSON. With follow, the stream
// ends at the current turn's boundary.
export async function* readDiscussionEvents(
  cursor: number,
  options: { readonly follow: boolean; readonly signal?: AbortSignal; readonly request?: string | null },
): AsyncGenerator<DiscussionEvent> {
  const response = await fetch(
    scoped("/api/chat/events", options.request, { cursor: String(cursor), ...(options.follow ? { follow: "1" } : {}) }),
    { cache: "no-store", signal: options.signal },
  );

  yield* ndjsonLines<DiscussionEvent>(response);
}

// The lines of an NDJSON response, such as a discussion's events or the shared
// requester conversation a host reads.
export async function* ndjsonLines<T>(response: Response): AsyncGenerator<T> {
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
      if (line.trim()) yield JSON.parse(line) as T;
    }

    if (done) return;
  }
}

import type { CommandFailure } from "@lib/contracts/command-errors";
import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import type { HostRequestItem, HostRequestOperation, HostRequestView } from "@lib/contracts/host-request";
import { ChatRequestError, ndjsonLines } from "./discussion";

// Browser access to the host's requests in /app (host-review-and-booking
// design 3): the inbox, one request's host projection, its card commands and
// the shared requester conversation, read-only. The browser never sees a
// booking link or calls /eve/v1.

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };

  if (!response.ok) {
    throw new ChatRequestError(response.status, body.code ?? "unavailable", body.error ?? "Something went wrong. Try again.");
  }

  return body as T;
}

export async function readHostRequests(signal?: AbortSignal) {
  const body = await readJson<{ requests: HostRequestItem[] }>(await fetch("/api/host/requests", { cache: "no-store", signal }));
  return body.requests;
}

// One request, or null when it is not this host's (or does not exist).
export async function readHostRequest(requestId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/host/requests/${encodeURIComponent(requestId)}`, { cache: "no-store", signal });
  if (response.status === 404) return null;
  return readJson<HostRequestView>(response);
}

export type HostCommandOutcome =
  | { readonly ok: true; readonly request: HostRequestView | null; readonly result: unknown }
  | { readonly ok: false; readonly request: HostRequestView | null; readonly error: CommandFailure };

export async function postHostCommand(
  requestId: string,
  operation: HostRequestOperation,
  input: unknown,
  expectedRevision: number | null,
  retryKey: string,
): Promise<HostCommandOutcome> {
  const response = await fetch(`/api/host/requests/${encodeURIComponent(requestId)}/commands`, {
    body: JSON.stringify({ expectedRevision, input, operation, retryKey }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: CommandFailure;
    request?: HostRequestView | null;
    result?: unknown;
  };

  if (response.ok) return { ok: true, request: body.request ?? null, result: body.result };
  return {
    error: body.error ?? { category: "internal", correlationId: "", message: "Something went wrong. Try again later." },
    ok: false,
    request: body.request ?? null,
  };
}

// The shared requester conversation's recorded events, from the start.
export async function* readSharedEvents(requestId: string, signal?: AbortSignal): AsyncGenerator<DiscussionEvent> {
  const response = await fetch(`/api/host/requests/${encodeURIComponent(requestId)}/shared`, { cache: "no-store", signal });
  yield* ndjsonLines<DiscussionEvent>(response);
}

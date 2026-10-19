import type { HandleAvailability } from "@lib/server/handles";
import type { SetupStateView } from "@lib/server/setup";
import type { SetupOperation } from "@lib/contracts/setup";

// Browser access to host setup. The cards talk only to /api/setup: the server
// derives the step, the proposal and readiness, and every card action runs as a
// command with the expected revision the card last saw and a retry key the card
// keeps across retries of the same intent.

export type SetupState = SetupStateView;

export class SetupRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SetupRequestError";
    this.code = code;
    this.status = status;
  }
}

// The browser's IANA zone, the timezone starter default the server offers when
// the calendar names none.
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function readSetupState(
  timeZone: string,
  options: { readonly calendars?: boolean; readonly signal?: AbortSignal } = {},
): Promise<SetupState> {
  const query = new URLSearchParams({ tz: timeZone });
  if (options.calendars) query.set("calendars", "1");
  const response = await fetch(`/api/setup/state?${query}`, { cache: "no-store", signal: options.signal });
  const body = (await response.json().catch(() => null)) as (SetupState & { code?: string; error?: string }) | null;

  if (!response.ok || !body) {
    throw new SetupRequestError(
      response.status,
      body?.code ?? "unavailable",
      body?.error ?? "Setup couldn't be loaded right now. Try again shortly.",
    );
  }

  return body;
}

export type SetupCommandRequest = {
  readonly operation: SetupOperation;
  readonly expectedRevision: number | null;
  readonly retryKey: string;
  readonly input: Readonly<Record<string, unknown>>;
};

// A command attempt: done, refused for a known reason (nothing was saved), or
// uncertain (the response was lost, so it may have been saved). An uncertain
// attempt is never resent with a new key; the card reloads state first.
export type SetupCommandAttempt<Result> =
  | { readonly kind: "ok"; readonly result: Result; readonly replayed: boolean }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "uncertain"; readonly message: string };

const UNCERTAIN = "We couldn't confirm whether that was saved. Check the card below before trying again.";

export async function runSetupCommand<Result = unknown>(request: SetupCommandRequest): Promise<SetupCommandAttempt<Result>> {
  let response: Response;

  try {
    response = await fetch("/api/setup/commands", {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch {
    return { kind: "uncertain", message: UNCERTAIN };
  }

  const body = (await response.json().catch(() => null)) as
    | { ok: true; result: Result; replayed: boolean }
    | { ok: false; error: { category: string; message: string } }
    | { code?: string; error?: string }
    | null;

  if (!body) return { kind: "uncertain", message: UNCERTAIN };
  if ("ok" in body && body.ok) return { kind: "ok", replayed: body.replayed, result: body.result };
  if ("ok" in body && !body.ok) return { code: body.error.category, kind: "refused", message: body.error.message };

  const plain = body as { code?: string; error?: string };
  return {
    code: plain.code ?? "unavailable",
    kind: "refused",
    message: plain.error ?? "Something went wrong. Try again.",
  };
}

export async function checkHandle(candidate: string, signal?: AbortSignal) {
  const response = await fetch(`/api/setup/handle?${new URLSearchParams({ candidate })}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => null)) as
    | { handle: string; availability: HandleAvailability; code?: undefined }
    | { code: string; error: string }
    | null;

  if (!response.ok || !body || "code" in body) {
    throw new SetupRequestError(response.status, body?.code ?? "unavailable", "The handle couldn't be checked right now.");
  }

  return body;
}

// Retry identity for card actions: the same intent (the same requests, from the
// same revision) keeps its keys, so resending after a lost response replays the
// saved outcome instead of writing twice; a new intent gets new keys.
export function createRetryKeys(generate: () => string = () => crypto.randomUUID()) {
  let pending: { signature: string; keys: string[] } | null = null;

  return {
    keysFor(signature: string, count: number) {
      if (pending?.signature !== signature || pending.keys.length !== count) {
        pending = { keys: Array.from({ length: count }, generate), signature };
      }
      return pending.keys;
    },
    // The intent settled (saved or definitely refused): the next one starts fresh.
    settle() {
      pending = null;
    },
  };
}

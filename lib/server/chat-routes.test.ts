import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRouteDependencies } from "./chat-routes";

// The host chat adapter (unmounted since remove-host-web-chat) serves only the
// host's setup discussion: a call that names a request is refused before
// anything is read or sent, and is never answered from setup.

const calls = vi.hoisted(() => ({
  acceptHostMessage: vi.fn(async () => ({ inputId: "input", status: "sent" as const })),
  conversationStatus: vi.fn(async () => ({ generation: null, pendingInputs: 0, state: "none" as const })),
  discussionEvents: vi.fn(async function* () {}),
  recoverDiscussion: vi.fn(async () => ({ status: "not_failed" as const })),
}));

vi.mock("./supabase-auth", () => ({
  supabaseAuthConfigFromEnvironment: () => ({ publishableKey: "key", url: "http://auth.local" }),
  verifiedUserId: async () => "00000000-0000-4000-8000-000000000001",
}));

vi.mock("./conversations", async (original) => ({
  ...(await original<typeof import("./conversations")>()),
  acceptHostMessage: calls.acceptHostMessage,
}));

vi.mock("./recovery", () => ({
  conversationStatus: calls.conversationStatus,
  discussionEvents: calls.discussionEvents,
  recoverDiscussion: calls.recoverDiscussion,
}));

const { createEventsHandler, createMessageHandler, createRecoverHandler, createStateHandler, REQUEST_SCOPE_REFUSAL } = await import("./chat-routes");

const origin = "http://localhost:3000";
const deps = () =>
  ({
    appOrigin: origin,
    auth: { publishableKey: "key", url: "http://auth.local" },
    db: {},
    runtime: {},
    signingKey: "key",
  }) as unknown as ChatRouteDependencies;
const requestId = "00000000-0000-4000-8000-0000000000aa";

function post(path: string, body: unknown) {
  return new Request(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
}

beforeEach(() => {
  for (const call of Object.values(calls)) call.mockClear();
});

describe("the host chat routes", () => {
  it("refuses a message that names a request and sends nothing", async () => {
    const response = await createMessageHandler(deps)(post("/api/chat/messages", { clientInputId: requestId, message: "Approve it", request: requestId }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REQUEST_SCOPE_REFUSAL);
    expect(calls.acceptHostMessage).not.toHaveBeenCalled();
  });

  it("sends a setup message to the setup discussion only", async () => {
    const response = await createMessageHandler(deps)(post("/api/chat/messages", { clientInputId: requestId, message: "Hello" }));

    expect(response.status).toBe(202);
    expect(calls.acceptHostMessage).toHaveBeenCalledWith(expect.anything(), expect.any(String), { clientInputId: requestId, message: "Hello" });
  });

  it("refuses state and history reads that name a request", async () => {
    const state = await createStateHandler(deps)(new Request(`${origin}/api/chat/state?request=${requestId}`));
    const events = await createEventsHandler(deps)(new Request(`${origin}/api/chat/events?cursor=0&request=${requestId}`));

    for (const response of [state, events]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(REQUEST_SCOPE_REFUSAL);
    }
    expect(calls.conversationStatus).not.toHaveBeenCalled();
    expect(calls.discussionEvents).not.toHaveBeenCalled();
  });

  it("refuses a recovery that names a request", async () => {
    const response = await createRecoverHandler(deps)(post("/api/chat/recover", { observedGeneration: 1, request: requestId }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REQUEST_SCOPE_REFUSAL);
    expect(calls.recoverDiscussion).not.toHaveBeenCalled();
  });

  it("refuses an empty request scope on a read", async () => {
    const response = await createStateHandler(deps)(new Request(`${origin}/api/chat/state?request=`));

    expect(response.status).toBe(400);
    expect(calls.conversationStatus).not.toHaveBeenCalled();
  });

  it("answers a null or array body as an invalid message, not as a request scope", async () => {
    for (const body of [null, [requestId]]) {
      const response = await createMessageHandler(deps)(post("/api/chat/messages", body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_message" });
    }
    expect(calls.acceptHostMessage).not.toHaveBeenCalled();
  });
});

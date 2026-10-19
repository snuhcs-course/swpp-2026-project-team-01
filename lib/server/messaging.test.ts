import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMAND_ERROR_MESSAGES } from "../contracts/command-errors";
import { gateTransport, type MessagingTransport, withMessagingAdmission } from "./messaging";

type Message = { readonly to: string; readonly text: string; readonly authorizedBy: string | null };

const credential = "am_live_9f8e7d6c5b4a3210";
const production = { AGENTMAIL_API_KEY: credential, VERCEL: "1", VERCEL_ENV: "production" };
const denied = [
  ["a preview with copied credentials", { AGENTMAIL_API_KEY: credential, VERCEL: "1", VERCEL_ENV: "preview" }],
  ["a custom environment", { AGENTMAIL_API_KEY: credential, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "qa" }],
  ["Vercel development", { AGENTMAIL_API_KEY: credential, VERCEL: "1", VERCEL_ENV: "development" }],
  ["VERCEL without VERCEL_ENV", { AGENTMAIL_API_KEY: credential, VERCEL: "1" }],
  ["VERCEL_ENV without VERCEL", { AGENTMAIL_API_KEY: credential, VERCEL_ENV: "production" }],
  [
    "a production label on another target",
    { AGENTMAIL_API_KEY: credential, VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "qa" },
  ],
] as const;

// A fake provider adapter: it applies its own authority check, then makes the
// provider request through fetch, which the tests replace.
function fakeTransport(): MessagingTransport<Message, { id: string }> & { sent: Message[] } {
  const sent: Message[] = [];

  return {
    send: async (message) => {
      if (!message.authorizedBy) {
        throw new Error("The transport refuses a message without current sender authority.");
      }

      const response = await fetch("https://api.agentmail.test/v0/messages", {
        body: JSON.stringify(message),
        headers: { authorization: `Bearer ${credential}` },
        method: "POST",
      });
      sent.push(message);
      return (await response.json()) as { id: string };
    },
    sent,
  };
}

const message: Message = { authorizedBy: "request:1", text: "Your meeting is confirmed.", to: "guest@example.test" };

function mockNetwork() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "msg_1" }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("messaging-environment gate", () => {
  it.each(denied)("refuses %s before any network call", async (_label, env) => {
    const network = mockNetwork();
    const transport = fakeTransport();

    const failure = await gateTransport(transport, env)
      .send(message)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      category: "unavailable_configuration",
      message: COMMAND_ERROR_MESSAGES.unavailable_configuration,
    });
    expect(String((failure as Error).message)).not.toMatch(/preview|development|qa|VERCEL|am_live/);
    expect(network).not.toHaveBeenCalled();
    expect(transport.sent).toEqual([]);
  });

  it.each(denied)("leaves delivery state untouched when %s wakes a delivery worker", async (_label, env) => {
    const network = mockNetwork();
    const delivery = { attempts: 0, leaseOwner: null as string | null, state: "pending", uncertain: false };
    const snapshot = structuredClone(delivery);
    const transport = gateTransport(fakeTransport(), env);
    const claim = vi.fn(async () => {
      delivery.leaseOwner = "worker";
      delivery.attempts += 1;
      await transport.send(message);
      delivery.state = "sent";
    });

    await expect(withMessagingAdmission(claim, env)).rejects.toMatchObject({ category: "unavailable_configuration" });

    expect(claim).not.toHaveBeenCalled();
    expect(delivery).toEqual(snapshot);
    expect(network).not.toHaveBeenCalled();
  });

  it("sends in production when the transport's own checks pass", async () => {
    const network = mockNetwork();
    const transport = fakeTransport();

    await expect(gateTransport(transport, production).send(message)).resolves.toEqual({ id: "msg_1" });
    expect(network).toHaveBeenCalledTimes(1);
    expect(transport.sent).toEqual([message]);
  });

  it("still applies the transport's authority check in production", async () => {
    const network = mockNetwork();
    const transport = fakeTransport();

    await expect(gateTransport(transport, production).send({ ...message, authorizedBy: null })).rejects.toThrow(
      "current sender authority",
    );
    expect(network).not.toHaveBeenCalled();
    expect(transport.sent).toEqual([]);
  });

  it("admits standalone local execution, which keeps the transport's checks", async () => {
    mockNetwork();
    const transport = fakeTransport();

    await expect(gateTransport(transport, { AGENTMAIL_API_KEY: credential }).send(message)).resolves.toEqual({
      id: "msg_1",
    });
    await expect(
      gateTransport(transport, {}).send({ ...message, authorizedBy: null }),
    ).rejects.toThrow("current sender authority");
  });
});

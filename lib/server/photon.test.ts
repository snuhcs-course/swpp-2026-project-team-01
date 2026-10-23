import { describe, expect, it, vi } from "vitest";
import { photonConfig, photonTransport, SPECTRUM_ENDPOINT, standInTransport } from "./photon";

// The transport's outcome classification and the messaging gate
// (host-imessage-channel design 3): a stand-in answer maps to accepted,
// rejected or uncertain, a refused connection to unavailable, and the gate
// refuses previews and non-loopback local sends before any network access.

const request = { content: { kind: "text" as const, text: "Hi" }, idempotencyKey: "o1", recipient: { address: "+15551234567", spaceId: null } };

function answering(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("standInTransport", () => {
  it("maps answers to outcomes", async () => {
    const accepted = await standInTransport("http://127.0.0.1:9", "s", answering(200, { messageId: "m1", spaceId: "any;-;+1" })).send(request);
    expect(accepted).toEqual({ messageId: "m1", spaceId: "any;-;+1", status: "accepted" });
    expect(await standInTransport("http://127.0.0.1:9", "s", answering(422, { category: "not_imessage" })).send(request)).toEqual({
      category: "not_imessage",
      status: "rejected",
    });
    expect(await standInTransport("http://127.0.0.1:9", "s", answering(400, { category: "weird" })).send(request)).toEqual({
      category: "provider_rejected",
      status: "rejected",
    });
    expect(await standInTransport("http://127.0.0.1:9", "s", answering(401)).send(request)).toEqual({ category: "provider_authentication", status: "rejected" });
    expect(await standInTransport("http://127.0.0.1:9", "s", answering(503)).send(request)).toEqual({ status: "uncertain" });
  });

  it("sends the idempotency key and treats a refused connection as unavailable and a lost answer as uncertain", async () => {
    const fetcher = answering(200, {});
    await standInTransport("http://127.0.0.1:9/", "secret", fetcher).send(request);
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9/messages");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("o1");

    const refused = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    expect(await standInTransport("http://127.0.0.1:9", "s", refused).send(request)).toEqual({ status: "unavailable" });
    const reset = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    }) as unknown as typeof fetch;
    expect(await standInTransport("http://127.0.0.1:9", "s", reset).send(request)).toEqual({ status: "uncertain" });
  });
});

describe("photonTransport", () => {
  it("uses the stand-in locally and Spectrum in production, which ignores PHOTON_API_URL", () => {
    const local = { PHOTON_API_URL: "http://127.0.0.1:4100" };
    expect(photonTransport(photonConfig(local), local).endpoint).toBe("http://127.0.0.1:4100");
    const production = { ...local, VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" };
    expect(photonTransport(photonConfig(production), production).endpoint).toBe(SPECTRUM_ENDPOINT);
  });

  it("refuses a preview and a local send toward the real endpoint before any network access", async () => {
    const preview = { PHOTON_API_URL: "http://127.0.0.1:4100", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };
    await expect(photonTransport(photonConfig(preview), preview).send(request)).rejects.toMatchObject({ category: "unavailable_configuration" });
    await expect(photonTransport(photonConfig({}), {}).send(request)).rejects.toMatchObject({ category: "unavailable_configuration" });
  });
});

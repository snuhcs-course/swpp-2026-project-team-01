import { describe, expect, it, vi } from "vitest";
import { photonConfig, photonRegistrar, photonTransport, SPECTRUM_ENDPOINT, spectrumTransport, standInTransport } from "./photon";

// The transport's outcome classification and the messaging gate
// (host-imessage-channel design 3): a stand-in answer maps to accepted,
// rejected or uncertain, a refused connection to unavailable, and the gate
// refuses previews and non-loopback local sends before any network access.

const request = { channel: "imessage" as const, content: { kind: "text" as const, text: "Hi" }, idempotencyKey: "o1", recipient: { address: "+15551234567", spaceId: null } };

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

// host-whatsapp-channel task 2.3: WhatsApp's path, Meta's refusals and the gate.
describe("signals", () => {
  const signal = {
    ...request,
    content: { kind: "signal" as const, messageId: "m-host-1", reaction: "❤️", typing: false },
    recipient: { address: "+15551234567", spaceId: "any;-;+15551234567" },
  };

  it("carries the signal to the stand-in as it is", async () => {
    const fetcher = answering(200, {});
    expect(await standInTransport("http://127.0.0.1:9", "s", fetcher).send(signal)).toMatchObject({ status: "accepted" });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ content: signal.content });
  });

  it("refuses a signal with no conversation, and on WhatsApp, before any network access", async () => {
    const spectrum = spectrumTransport({ projectId: "p", projectSecret: "s" });
    expect(await spectrum.send({ ...signal, recipient: { ...signal.recipient, spaceId: null } })).toEqual({ category: "invalid_recipient", status: "rejected" });
    expect(await spectrum.send({ ...signal, channel: "whatsapp" })).toEqual({ category: "provider_rejected", status: "rejected" });
  });
});

describe("WhatsApp sends", () => {
  const whatsapp = { ...request, channel: "whatsapp" as const, recipient: { address: "15551234567", spaceId: "15551234567" } };
  const template = { ...whatsapp, content: { kind: "template" as const, languageCode: "en_US", name: "fmat_proposal_waiting", params: ["K7Q2MX"] } };

  it("posts WhatsApp to the stand-in's WhatsApp path with the template", async () => {
    const fetcher = answering(200, { messageId: "wamid.1", spaceId: "15551234567" });
    expect(await standInTransport("http://127.0.0.1:9", "s", fetcher).send(template)).toMatchObject({ status: "accepted" });
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9/whatsapp/messages");
    expect(JSON.parse(String(init.body))).toMatchObject({ content: template.content, recipient: whatsapp.recipient });
  });

  it("maps the stand-in's window, template and rate-limit answers", async () => {
    expect(await standInTransport("http://127.0.0.1:9", "s", answering(422, { category: "window_closed" })).send(whatsapp)).toEqual({
      category: "window_closed",
      status: "rejected",
    });
    expect(await standInTransport("http://127.0.0.1:9", "s", answering(422, { category: "template_unavailable" })).send(template)).toEqual({
      category: "template_unavailable",
      status: "rejected",
    });
    expect(await standInTransport("http://127.0.0.1:9", "s", answering(429)).send(whatsapp)).toEqual({ status: "unavailable" });
  });

  it("refuses WhatsApp in a preview before any network access", async () => {
    const preview = { PHOTON_API_URL: "http://127.0.0.1:4100", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };
    await expect(photonTransport(photonConfig(preview), preview).send(whatsapp)).rejects.toMatchObject({ category: "unavailable_configuration" });
  });

  it("reads the WhatsApp number as digits", () => {
    expect(photonConfig({ PHOTON_WHATSAPP_NUMBER: " +15550002222 " }).whatsappNumber).toBe("15550002222");
  });
});

describe("photonRegistrar", () => {
  const assigned = { data: { assignedPhoneNumber: "+15550009999", phoneNumber: "+15551234567", type: "shared" }, succeed: true };

  it("registers a shared user with the stand-in locally and maps its answers", async () => {
    const local = { PHOTON_API_URL: "http://127.0.0.1:4100/" };
    const fetcher = answering(200, assigned);
    expect(await photonRegistrar(photonConfig(local), local, fetcher).send("+15551234567")).toEqual({ lineNumber: "+15550009999", status: "registered" });
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4100/users");
    expect(JSON.parse(String(init.body))).toEqual({ phoneNumber: "+15551234567", type: "shared" });

    expect(await photonRegistrar(photonConfig(local), local, answering(422)).send("+15551234567")).toEqual({ status: "refused" });
    expect(await photonRegistrar(photonConfig(local), local, answering(200, { succeed: true })).send("+15551234567")).toEqual({ status: "unavailable" });
    expect(await photonRegistrar(photonConfig(local), local, answering(503)).send("+15551234567")).toEqual({ status: "unavailable" });
  });

  it("calls Spectrum's users API with the project credentials in production", async () => {
    const production = { PHOTON_PROJECT_ID: "proj", PHOTON_PROJECT_SECRET: "sec", VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" };
    const fetcher = answering(200, assigned);
    await photonRegistrar(photonConfig(production), production, fetcher).send("+15551234567");
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${SPECTRUM_ENDPOINT}/projects/proj/users/`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("proj:sec").toString("base64")}`);
  });

  it("refuses a preview before any network access", async () => {
    const preview = { PHOTON_API_URL: "http://127.0.0.1:4100", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };
    const fetcher = answering(200, assigned);
    await expect(photonRegistrar(photonConfig(preview), preview, fetcher).send("+15551234567")).rejects.toMatchObject({ category: "unavailable_configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

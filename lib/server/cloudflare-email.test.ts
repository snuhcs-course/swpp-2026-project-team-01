import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_API_URL,
  classifySendResponse,
  cloudflareEmailConfigFromEnvironment,
  cloudflareEmailTransport,
} from "./cloudflare-email";

const recipient = "guest@example.test";
const message = {
  dispatchId: "4d1f1b8a-1c1a-4c1a-9c1a-1c1a1c1a1c1a",
  from: "Find Me a Time <no-reply@findmeatime.com>",
  html: "<p>Hi</p>",
  subject: "Hi",
  text: "Hi",
  to: [recipient],
};

describe("Cloudflare email configuration", () => {
  it("uses the stand-in URL outside production and ignores it on production", () => {
    const env = { CLOUDFLARE_EMAIL_API_URL: "http://127.0.0.1:3104/" };

    expect(cloudflareEmailConfigFromEnvironment(env).baseUrl).toBe("http://127.0.0.1:3104");
    expect(cloudflareEmailConfigFromEnvironment({ ...env, VERCEL: "1", VERCEL_ENV: "production" }).baseUrl).toBe(
      CLOUDFLARE_API_URL,
    );
  });

  it("refuses to send without configuration before any network call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const transport = cloudflareEmailTransport(cloudflareEmailConfigFromEnvironment({}), fetchImpl);

    await expect(transport.send(message)).rejects.toMatchObject({ category: "unavailable_configuration" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts one message with the bearer token and the dispatch header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ result: { delivered: [recipient], permanent_bounces: [], queued: [] }, success: true }),
    );
    const transport = cloudflareEmailTransport(
      cloudflareEmailConfigFromEnvironment({
        CLOUDFLARE_ACCOUNT_ID: "acct",
        CLOUDFLARE_EMAIL_API_TOKEN: "token",
        CLOUDFLARE_EMAIL_FROM: "no-reply@findmeatime.com",
      }),
      fetchImpl,
    );

    await expect(transport.send(message)).resolves.toMatchObject({ messageId: null, status: "accepted" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send");
    expect(init?.headers).toMatchObject({ authorization: "Bearer token" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      headers: { "X-Fmat-Dispatch-Id": message.dispatchId },
      to: [recipient],
    });
  });

  it("treats a network failure as uncertain", async () => {
    const transport = cloudflareEmailTransport(
      { accountId: "a", apiToken: "t", baseUrl: CLOUDFLARE_API_URL, from: "f", timeoutMs: 10 },
      async () => {
        throw new TypeError("fetch failed");
      },
    );

    await expect(transport.send(message)).resolves.toEqual({ httpStatus: null, reason: "lost_response", status: "uncertain" });
  });
});

describe("Cloudflare send response classification", () => {
  const result = (fields: Record<string, unknown>) => ({
    result: { delivered: [], permanent_bounces: [], queued: [], ...fields },
    success: true,
  });

  it("accepts only when every recipient is delivered or queued", () => {
    expect(classifySendResponse(200, result({ delivered: [recipient] }), [recipient]).status).toBe("accepted");
    expect(classifySendResponse(200, result({ queued: ["GUEST@example.test"] }), [recipient]).status).toBe("accepted");
    expect(classifySendResponse(200, result({ delivered: [recipient] }), [recipient, "b@example.test"])).toMatchObject({
      reason: "missing_evidence",
      status: "uncertain",
    });
  });

  it("keeps a message ID when a response returns one", () => {
    expect(classifySendResponse(200, result({ delivered: [recipient], message_id: "m-1" }), [recipient])).toMatchObject({
      messageId: "m-1",
    });
  });

  it("rejects a bounce, a refusal and an unsuccessful body", () => {
    expect(classifySendResponse(200, result({ permanent_bounces: [recipient] }), [recipient])).toMatchObject({
      reason: "bounced",
      status: "rejected",
    });
    expect(classifySendResponse(429, null, [recipient])).toMatchObject({ httpStatus: 429, status: "rejected" });
    expect(classifySendResponse(403, null, [recipient]).status).toBe("rejected");
    expect(classifySendResponse(200, { result: null, success: false }, [recipient]).status).toBe("rejected");
  });

  it("treats a server error or an unreadable success as uncertain", () => {
    expect(classifySendResponse(502, null, [recipient])).toMatchObject({ reason: "server_error", status: "uncertain" });
    expect(classifySendResponse(200, null, [recipient])).toMatchObject({ reason: "lost_response", status: "uncertain" });
    expect(classifySendResponse(200, { success: true }, [recipient])).toMatchObject({ reason: "missing_evidence" });
  });
});

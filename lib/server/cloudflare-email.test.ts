import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_API_URL,
  classifySendResponse,
  cloudflareEmailConfigFromEnvironment,
  cloudflareEmailTransport,
  encodedSenderHeader,
  providerErrorsOf,
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

  it("sends a non-ASCII display name as encoded-words and keeps Cloudflare's refusal", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(
        { errors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }], messages: [], result: null, success: false },
        { status: 400 },
      ),
    );
    const transport = cloudflareEmailTransport(
      { accountId: "a", apiToken: "t", baseUrl: CLOUDFLARE_API_URL, from: "f", timeoutMs: 10 },
      fetchImpl,
    );

    await expect(transport.send({ ...message, from: "박도현 <no-reply@findmeatime.com>" })).resolves.toEqual({
      bounced: [],
      httpStatus: 400,
      providerErrors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }],
      reason: "refused",
      status: "rejected",
    });
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as { from: string };
    expect(sent.from).toBe(`=?UTF-8?B?${Buffer.from("박도현").toString("base64")}?= <no-reply@findmeatime.com>`);
    expect(sent.from).toMatch(/^[\x20-\x7e]+$/);
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

describe("Cloudflare sender header", () => {
  it("leaves an ASCII display name and a bare address unchanged", () => {
    expect(encodedSenderHeader("Find Me a Time <no-reply@findmeatime.com>")).toBe("Find Me a Time <no-reply@findmeatime.com>");
    expect(encodedSenderHeader("no-reply@findmeatime.com")).toBe("no-reply@findmeatime.com");
  });

  it("quotes an ASCII display name that holds specials", () => {
    expect(encodedSenderHeader("Park, Dohyeon <no-reply@findmeatime.com>")).toBe('"Park, Dohyeon" <no-reply@findmeatime.com>');
    expect(encodedSenderHeader("J. Doe (PM) <no-reply@findmeatime.com>")).toBe('"J. Doe (PM)" <no-reply@findmeatime.com>');
  });

  it("splits a long non-ASCII name into encoded-words of whole characters within 75 characters", () => {
    const name = "가".repeat(40);
    const header = encodedSenderHeader(`${name} <no-reply@findmeatime.com>`);
    const words = header.replace(/ <no-reply@findmeatime\.com>$/, "").split(" ");

    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    const decoded = words.map((word) => Buffer.from(word.slice("=?UTF-8?B?".length, -2), "base64").toString("utf8")).join("");
    expect(decoded).toBe(name);
  });
});

describe("Cloudflare provider errors", () => {
  it("keeps each error's code and message, masking addresses and bounding the list", () => {
    expect(
      providerErrorsOf({
        errors: [
          { code: 10202, message: "Invalid email content for guest@example.test" },
          { code: "E_HEADER_VALUE_INVALID", extra: "dropped" },
          "not an object",
          {},
        ],
      }),
    ).toEqual([
      { code: 10202, message: "Invalid email content for [address]" },
      { code: "E_HEADER_VALUE_INVALID", message: null },
    ]);
    expect(providerErrorsOf({ errors: Array.from({ length: 9 }, (_, code) => ({ code })) })).toHaveLength(5);
    expect(providerErrorsOf({ errors: [{ code: 1, message: "x".repeat(500) }] })[0]?.message).toHaveLength(200);
    expect(providerErrorsOf({ errors: [{ code: 1, message: `${"x".repeat(199)}😀😀` }] })[0]?.message).toBe(`${"x".repeat(199)}😀`);
    expect(providerErrorsOf(null)).toEqual([]);
  });

  it("records the errors on a refusal and a server error, and omits them when none were named", () => {
    const refusal = { errors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }], result: null, success: false };

    expect(classifySendResponse(400, refusal, [recipient])).toMatchObject({
      providerErrors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }],
      reason: "refused",
    });
    expect(classifySendResponse(200, refusal, [recipient])).toMatchObject({ providerErrors: [{ code: 10001 }], status: "rejected" });
    expect(classifySendResponse(503, { errors: [{ code: 10100, message: "authentication.upstream" }] }, [recipient])).toMatchObject({
      providerErrors: [{ code: 10100 }],
      reason: "server_error",
    });
    expect(classifySendResponse(429, null, [recipient])).not.toHaveProperty("providerErrors");
  });
});

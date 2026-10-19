import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type InternalGrant, messageFingerprint, signInternalBearer, verifyInternalBearer } from "./internal-bearer";

const key = "a-test-signing-key-of-at-least-32-characters";
const grant: InternalGrant = {
  discussionId: randomUUID(),
  generation: 2,
  inputId: randomUUID(),
  kind: "send",
  messageFingerprint: messageFingerprint("Find me a time next week."),
  principal: { id: randomUUID(), type: "host_account" },
  sessionId: "wrun_01EXAMPLE",
};

function resign(token: string, change: (claims: Record<string, unknown>) => object, header = { alg: "HS256", typ: "JWT" }) {
  const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  const input = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(
    JSON.stringify(change(claims)),
  ).toString("base64url")}`;
  return `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}

describe("internal bearer", () => {
  it("round-trips a send and a create grant", () => {
    expect(verifyInternalBearer(signInternalBearer(grant, key), key)).toEqual(grant);

    const create: InternalGrant = { discussionId: grant.discussionId, generation: 1, kind: "create", principal: grant.principal };
    expect(verifyInternalBearer(signInternalBearer(create, key), key)).toEqual(create);
  });

  it("expires after 60 seconds", () => {
    const now = Date.now();
    const token = signInternalBearer(grant, key, now);

    expect(verifyInternalBearer(token, key, now + 59_000)).not.toBeNull();
    expect(verifyInternalBearer(token, key, now + 60_000)).toBeNull();
  });

  it("rejects another key, a tampered claim, another algorithm and a longer lifetime", () => {
    const token = signInternalBearer(grant, key);
    const [header, , signature] = token.split(".");
    const forged = `${header}.${Buffer.from(JSON.stringify({ pid: randomUUID() })).toString("base64url")}.${signature}`;

    expect(verifyInternalBearer(token, `${key}-other`)).toBeNull();
    expect(verifyInternalBearer(forged, key)).toBeNull();
    expect(verifyInternalBearer(resign(token, (claims) => claims, { alg: "none", typ: "JWT" }), key)).toBeNull();
    expect(verifyInternalBearer(resign(token, (claims) => ({ ...claims, exp: Number(claims.iat) + 3600 })), key)).toBeNull();
    expect(verifyInternalBearer(resign(token, (claims) => ({ ...claims, aud: "elsewhere" })), key)).toBeNull();
    expect(verifyInternalBearer(resign(token, (claims) => ({ ...claims, sid: undefined })), key)).toBeNull();
    expect(verifyInternalBearer("not.a.token", key)).toBeNull();
  });

  it("binds the bearer to the environment that signed it", () => {
    const token = signInternalBearer(grant, key, Date.now(), "production");

    expect(verifyInternalBearer(token, key, Date.now(), "production")).toEqual(grant);
    expect(verifyInternalBearer(token, key, Date.now(), "preview")).toBeNull();
    expect(verifyInternalBearer(signInternalBearer(grant, key, Date.now(), "preview"), key, Date.now(), "production")).toBeNull();
    expect(verifyInternalBearer(resign(token, (claims) => ({ ...claims, env: undefined })), key, Date.now(), "production")).toBeNull();
  });

  it("binds a send to its message fingerprint", () => {
    const token = signInternalBearer(grant, key);

    expect(verifyInternalBearer(resign(token, (claims) => ({ ...claims, fp: undefined })), key)).toBeNull();
    expect(messageFingerprint("Find me a time next week.")).not.toBe(messageFingerprint("Find me a time next week!"));
  });
});

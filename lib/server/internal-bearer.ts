import { createHmac, timingSafeEqual } from "node:crypto";
import type { Principal } from "./model-limits";

// The server-only bearer the web service presents to the agent service when it
// creates an eve session or sends an accepted input (design decision 7). It is an
// HS256 JWT signed with EVE_INTERNAL_SIGNING_KEY, names exactly what it authorizes
// and expires after 60 seconds. It never reaches a browser.

export const INTERNAL_BEARER_TTL_SECONDS = 60;
const ISSUER = "findmeatime:web";
const AUDIENCE = "findmeatime:agent";

export type InternalGrant =
  | {
      readonly kind: "create";
      readonly principal: Principal;
      readonly discussionId: string;
      readonly generation: number;
    }
  | {
      readonly kind: "send";
      readonly principal: Principal;
      readonly discussionId: string;
      readonly generation: number;
      readonly sessionId: string;
      readonly inputId: string;
    };

type Claims = {
  aud: string;
  did: string;
  exp: number;
  gen: number;
  iat: number;
  iid?: string;
  iss: string;
  kind: string;
  pid: string;
  pt: string;
  sid?: string;
};

export function internalSigningKey() {
  const key = process.env.EVE_INTERNAL_SIGNING_KEY;

  if (!key || key.length < 32) {
    throw new Error("EVE_INTERNAL_SIGNING_KEY must be set to at least 32 characters.");
  }

  return key;
}

function encode(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(input: string, key: string) {
  return createHmac("sha256", key).update(input).digest();
}

export function signInternalBearer(grant: InternalGrant, key: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const claims: Claims = {
    aud: AUDIENCE,
    did: grant.discussionId,
    exp: iat + INTERNAL_BEARER_TTL_SECONDS,
    gen: grant.generation,
    iat,
    iss: ISSUER,
    kind: grant.kind,
    pid: grant.principal.id,
    pt: grant.principal.type,
    ...(grant.kind === "send" ? { iid: grant.inputId, sid: grant.sessionId } : {}),
  };
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;

  return `${input}.${sign(input, key).toString("base64url")}`;
}

// Returns the grant, or null for anything that is not a current bearer this
// service signed: another algorithm, a bad signature, the wrong issuer or
// audience, an expired token or a malformed claim.
export function verifyInternalBearer(token: string, key: string, now = Date.now()): InternalGrant | null {
  const parts = token.split(".");

  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${payload}`, key);
  const actual = Buffer.from(signature, "base64url");

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let claims: Partial<Claims>;

  try {
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string };
    if (parsedHeader.alg !== "HS256") return null;
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Claims>;
  } catch {
    return null;
  }

  const seconds = Math.floor(now / 1000);

  if (
    claims.iss !== ISSUER ||
    claims.aud !== AUDIENCE ||
    typeof claims.exp !== "number" ||
    claims.exp <= seconds ||
    typeof claims.iat !== "number" ||
    claims.exp - claims.iat > INTERNAL_BEARER_TTL_SECONDS ||
    (claims.pt !== "host_account" && claims.pt !== "requester_request") ||
    typeof claims.pid !== "string" ||
    typeof claims.did !== "string" ||
    !Number.isInteger(claims.gen)
  ) {
    return null;
  }

  const base = {
    discussionId: claims.did,
    generation: claims.gen as number,
    principal: { id: claims.pid, type: claims.pt },
  } as const;

  if (claims.kind === "create") {
    return { ...base, kind: "create" };
  }

  if (claims.kind === "send" && typeof claims.sid === "string" && typeof claims.iid === "string") {
    return { ...base, inputId: claims.iid, kind: "send", sessionId: claims.sid };
  }

  return null;
}

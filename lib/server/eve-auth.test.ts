import { randomUUID } from "node:crypto";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it } from "vitest";
import type { Database } from "./database";
import { createAppAuth, createEvalRequesterAuth } from "./eve-auth";
import { signInternalBearer } from "./internal-bearer";

// Requests refused on their route alone; the database is never consulted.
const db = (() => {
  throw new Error("A malformed route must not reach the database.");
}) as unknown as Database;
const appAuth = createAppAuth(() => ({
  auth: { publishableKey: "publishable", url: "http://127.0.0.1:54321" },
  db,
  signingKey: "a-test-signing-key-of-at-least-32-characters",
}));

describe("appAuth routes", () => {
  it("refuses a malformed session ID as forbidden, not a server error", async () => {
    const malformed = "/eve/v1/session/%E0%A4%A";

    await expect(
      appAuth(new Request(`http://127.0.0.1${malformed}/stream`, { headers: { cookie: "sb-127-auth-token=x" } })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      appAuth(new Request(`http://127.0.0.1${malformed}`, { headers: { authorization: "Bearer a.b.c" }, method: "POST" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// A database stand-in answering the create path's index, status and discussion reads.
function fakeDatabase(audience: string | null) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("from app.agent_sessions")) return Promise.resolve([]);
    if (text.includes("from app.host_accounts")) return Promise.resolve([{ status: "active" }]);
    if (text.includes("from app.discussions")) return Promise.resolve(audience ? [{ audience }] : []);
    throw new Error(`Unexpected query: ${text}`);
  }) as unknown as Database;
}

describe("appAuth session attributes", () => {
  const signingKey = "a-test-signing-key-of-at-least-32-characters";
  const principal = { id: randomUUID(), type: "host_account" } as const;
  const create = (audience: string | null) => {
    const discussionId = randomUUID();
    const bearer = signInternalBearer({ discussionId, generation: 1, kind: "create", principal }, signingKey);
    const auth = createAppAuth(() => ({
      auth: { publishableKey: "publishable", url: "http://127.0.0.1:54321" },
      db: fakeDatabase(audience),
      signingKey,
    }));
    return {
      discussionId,
      result: auth(new Request("http://127.0.0.1/eve/v1/session", { headers: { authorization: `Bearer ${bearer}` }, method: "POST" })),
    };
  };

  it("names the host setup audience, discussion and generation", async () => {
    const { discussionId, result } = create("host_setup");

    await expect(result).resolves.toMatchObject({
      attributes: { audience: "host_setup", discussionId, generation: "1" },
      principalId: principal.id,
      principalType: "user",
    });
  });

  it("refuses a discussion that is missing, someone else's or another audience", async () => {
    await expect(create(null).result).rejects.toBeInstanceOf(ForbiddenError);
    await expect(create("requester").result).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("evalRequesterAuth", () => {
  const untouched = () => {
    throw new Error("A skipped eval request must not reach the database.");
  };
  const create = (headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:2000/eve/v1/session", { headers: { "x-fmat-eval-request": randomUUID(), ...headers }, method: "POST" });

  it("skips unless requester evals are switched on outside Vercel", async () => {
    expect(await createEvalRequesterAuth(untouched as never, {})(create())).toBeNull();
    expect(await createEvalRequesterAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "requester", VERCEL: "1", VERCEL_ENV: "production" })(create())).toBeNull();
  });

  it("skips a request that carries a credential, and any process that is not eve dev", async () => {
    const auth = createEvalRequesterAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "requester" });
    expect(await auth(create({ authorization: "Bearer anything" }))).toBeNull();
    // Unit tests do not run inside an eve dev server, so localDev admits nothing.
    expect(await auth(create())).toBeNull();
  });
});

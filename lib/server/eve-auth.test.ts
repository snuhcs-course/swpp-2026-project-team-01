import { randomUUID } from "node:crypto";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it } from "vitest";
import type { Database } from "./database";
import { createAppAuth, createEvalHostReviewAuth, createEvalHostSetupAuth, createEvalRequesterAuth } from "./eve-auth";
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

describe("evalHostReviewAuth", () => {
  const untouched = () => {
    throw new Error("A skipped eval request must not reach the database.");
  };
  const create = (headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:2000/eve/v1/session", { headers: { "x-fmat-eval-request": randomUUID(), ...headers }, method: "POST" });

  it("skips unless host-review evals are switched on outside Vercel", async () => {
    expect(await createEvalHostReviewAuth(untouched as never, {})(create())).toBeNull();
    expect(await createEvalHostReviewAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "requester" })(create())).toBeNull();
    expect(await createEvalHostReviewAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "host_review", VERCEL: "1", VERCEL_ENV: "production" })(create())).toBeNull();
    expect(await createEvalHostReviewAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "host_review", VERCEL: "1", VERCEL_ENV: "preview" })(create())).toBeNull();
  });

  it("skips a request that carries a credential, and any process that is not eve dev", async () => {
    const auth = createEvalHostReviewAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "host_review" });
    expect(await auth(create({ authorization: "Bearer anything" }))).toBeNull();
    expect(await auth(create({ cookie: "sb-project-auth-token=anything" }))).toBeNull();
    // Unit tests do not run inside an eve dev server, so localDev admits nothing.
    expect(await auth(create())).toBeNull();
  });
});

describe("evalHostSetupAuth", () => {
  const untouched = () => {
    throw new Error("A skipped eval request must not reach the database.");
  };
  const create = (headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:2000/eve/v1/session", { headers: { "x-fmat-eval-host": randomUUID(), ...headers }, method: "POST" });

  it("skips unless host setup evals are switched on outside Vercel", async () => {
    expect(await createEvalHostSetupAuth(untouched as never, {})(create())).toBeNull();
    expect(await createEvalHostSetupAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "requester" })(create())).toBeNull();
    expect(await createEvalHostSetupAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "host_review" })(create())).toBeNull();
    expect(await createEvalHostSetupAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "host_setup", VERCEL: "1", VERCEL_ENV: "production" })(create())).toBeNull();
    expect(await createEvalHostSetupAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "host_setup", VERCEL: "1", VERCEL_ENV: "preview" })(create())).toBeNull();
  });

  it("skips a request that carries a credential, and any process that is not eve dev", async () => {
    const auth = createEvalHostSetupAuth(untouched as never, { FMAT_EVAL_AUDIENCE: "host_setup" });
    expect(await auth(create({ authorization: "Bearer anything" }))).toBeNull();
    expect(await auth(create({ cookie: "sb-project-auth-token=anything" }))).toBeNull();
    // Unit tests do not run inside an eve dev server, so localDev admits nothing.
    expect(await auth(create())).toBeNull();
  });
});

describe("evalHostSetupAuth admitting a seeded setup session", () => {
  const env = { FMAT_EVAL_AUDIENCE: "host_setup" };
  const caller = { authenticator: "local", principalId: "local", principalType: "user" };
  const local = async () => caller as never;
  const hostId = randomUUID();
  const discussionId = randomUUID();

  // Answers the entry's two lookups as the local database would: only a host
  // setup discussion of a host account, by the values the query is given.
  function setupDatabase(seeded: { audience: string; principalType: string }) {
    const queries: { text: string; values: unknown[] }[] = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      queries.push({ text, values });
      const isSetup = seeded.principalType === "host_account" && values.includes(seeded.audience) && seeded.audience === "host_setup";
      if (text.includes("from app.discussions d") && !text.includes("agent_sessions")) {
        return Promise.resolve(isSetup && values.includes(hostId) ? [{ discussion_id: discussionId, generation: 1, host_id: hostId }] : []);
      }
      if (text.includes("from app.agent_sessions s")) {
        return Promise.resolve(isSetup && values.includes("session-1") ? [{ discussion_id: discussionId, generation: 2, host_id: hostId }] : []);
      }
      throw new Error(`Unexpected query: ${text}`);
    }) as unknown as Database;
    return { db, queries };
  }

  const request = (path: string, method: string, headers: Record<string, string> = {}) =>
    new Request(`http://127.0.0.1:2000/eve/v1${path}`, { headers, method });

  it("admits the seeded host's setup discussion on create and its indexed session afterwards", async () => {
    const { db } = setupDatabase({ audience: "host_setup", principalType: "host_account" });
    const auth = createEvalHostSetupAuth(() => ({ db }), env, local);

    await expect(auth(request("/session", "POST", { "x-fmat-eval-host": hostId }))).resolves.toMatchObject({
      allowToolStubs: true,
      attributes: { audience: "host_setup", discussionId, generation: "1" },
      principalId: hostId,
      principalType: "user",
    });
    const sent = await auth(request("/session/session-1", "POST"));
    expect(sent).toMatchObject({ attributes: { audience: "host_setup", discussionId, generation: "2" }, principalId: hostId });
    // A setup principal names no request.
    expect((sent as { attributes: Record<string, string> }).attributes.requestId).toBeUndefined();
    await expect(auth(request("/session/session-1/stream", "GET"))).resolves.toMatchObject({ principalId: hostId });
  });

  it("returns the local caller for the info route and admits nothing else", async () => {
    const { db, queries } = setupDatabase({ audience: "host_setup", principalType: "host_account" });
    const auth = createEvalHostSetupAuth(() => ({ db }), env, local);

    expect(await auth(request("/info", "GET"))).toBe(caller);
    // No header, a header that is not an ID, an unknown host and an unknown session.
    expect(await auth(request("/session", "POST"))).toBeNull();
    expect(await auth(request("/session", "POST", { "x-fmat-eval-host": "not-an-id" }))).toBeNull();
    expect(await auth(request("/session", "POST", { "x-fmat-eval-host": randomUUID() }))).toBeNull();
    expect(await auth(request("/session/other-session", "POST"))).toBeNull();
    // Every lookup asks for the host setup audience of a host account.
    for (const query of queries) {
      expect(query.values).toContain("host_setup");
      expect(query.text).toContain("'host_account'");
    }
  });

  it("refuses a host-review or requester discussion of the same host", async () => {
    for (const seeded of [
      { audience: "host_review", principalType: "host_account" },
      { audience: "requester", principalType: "requester_request" },
    ]) {
      const { db } = setupDatabase(seeded);
      const auth = createEvalHostSetupAuth(() => ({ db }), env, local);
      expect(await auth(request("/session", "POST", { "x-fmat-eval-host": hostId }))).toBeNull();
      expect(await auth(request("/session/session-1", "POST"))).toBeNull();
    }
  });
});

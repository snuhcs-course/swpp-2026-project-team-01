import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localStack } from "./support/auth";
import { buildEve, type EveServer, eveEnvironment, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";

// The agent service's routes outside the session API, against the deployment
// build served by `eve start`. Callback, task-input, cron and workflow webhook
// paths are reachable on the public origin; with no channel, tool or schedule
// registered, each must refuse an unauthenticated caller without starting work,
// as must the AgentMail receiver without a registered receiver and a signature,
// and no response, health included, may reveal configuration or internals.

let fake: FakeOpenAI;
let server: EveServer;

beforeAll(async () => {
  fake = await startFakeOpenAI();
  await buildEve(eveEnvironment({ modelBaseURL: fake.baseURL, signingKey: "build-time-placeholder" }));
  server = await startEve("build", { modelBaseURL: fake.baseURL });
}, 400_000);

afterAll(async () => {
  await server?.stop();
  await fake.close();
});

function leaks(body: string) {
  const { PUBLISHABLE_KEY, SECRET_KEY } = localStack();
  return [server.signingKey, PUBLISHABLE_KEY, SECRET_KEY, "sk-test", "postgres", "/Users/", "/home/", "node_modules", "    at "].filter(
    (secret) => body.includes(secret),
  );
}

describe("agent service surface", () => {
  it("reports health without revealing configuration", async () => {
    const response = await fetch(`${server.url}/eve/v1/health`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["ok", "status", "workflowId"]);
    expect(leaks(body)).toEqual([]);
  });

  it.each([
    ["GET", "/eve/v1/callback/abc"],
    ["POST", "/eve/v1/callback/abc"],
    ["GET", "/eve/v1/connections/x/callback"],
    ["POST", "/eve/v1/connections/x/callback"],
    ["GET", "/eve/v1/task-input/abc"],
    ["POST", "/eve/v1/task-input/abc"],
    ["POST", "/eve/v1/cron/abc"],
    ["GET", "/.well-known/workflow/v1/webhook/abc"],
    ["POST", "/.well-known/workflow/v1/webhook/abc"],
    ["POST", "/.well-known/workflow/v1/flow"],
    ["POST", "/.well-known/workflow/v1/step"],
    ["GET", "/eve/v1/dev/runtime-artifacts"],
    ["GET", "/eve/v1/dev/internal/model-credential"],
    ["POST", "/eve/v1/mcp"],
    ["GET", "/eve/v1/session/%E0%A4%A/stream"],
    // The AgentMail receiver (requester-email-channel design 1): unsigned, or
    // naming no registered receiver, it stores nothing and starts no work.
    ["POST", "/agentmail/webhooks/abc"],
    ["POST", "/agentmail/webhooks/00000000-0000-4000-8000-000000000000"],
    ["GET", "/agentmail/webhooks/00000000-0000-4000-8000-000000000000"],
  ])("refuses %s %s without starting work or leaking internals", async (method, path) => {
    const requests = fake.requests.length;
    const response = await fetch(`${server.url}${path}`, {
      body: method === "POST" ? JSON.stringify({ message: "Book it." }) : undefined,
      headers: { "content-type": "application/json", cookie: "sb-127-auth-token=not-a-session" },
      method,
    });
    const body = await response.text();

    // 400 is eve's refusal of an unsupported callback kind or an unsigned
    // workflow queue message: still a refusal, before any work.
    expect([400, 401, 403, 404]).toContain(response.status);
    expect(leaks(body)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.requests.length).toBe(requests);
  });
});

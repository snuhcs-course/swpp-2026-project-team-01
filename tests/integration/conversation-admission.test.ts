import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { chatError } from "../../lib/server/chat-routes";
import {
  ADMISSION_LIMITED_MESSAGE,
  type AdmissionLimits,
  AdmissionLimitError,
  admitConversationInput,
} from "../../lib/server/conversation-admission";
import {
  acceptHostMessage,
  type ConversationDependencies,
  type ConversationRuntime,
  deliverNext,
  lockSetupDiscussion,
} from "../../lib/server/conversations";
import { acceptGuestMessage } from "../../lib/server/guest-conversations";
import { messageFingerprint } from "../../lib/server/internal-bearer";
import { testDatabase } from "./support/database";
import { createTestRequest } from "./support/requests";

// Conversation admission and credential redaction in the host message path
// (design decision 14), against the local database with a recording runtime in
// place of eve. Each test charges its own service window key, so suites sharing
// the stack never exhaust each other's budget.

const db = testDatabase();
const signingKey = "admission-test-signing-key-0123456789abcdef";

afterAll(async () => {
  await db.end();
});

type Sent = { sessionId: string; message: string };

function recordingRuntime(sent: Sent[]): ConversationRuntime {
  return {
    createSession: async () => `wrun_${randomUUID()}`,
    readEvents: () => (async function* () {})(),
    readRecordedEvents: () => (async function* () {})(),
    sendMessage: async (sessionId, _bearer, message) => {
      sent.push({ message, sessionId });
    },
  };
}

function dependencies(limits: Partial<AdmissionLimits> = {}, serviceKey = `test:${randomUUID()}`) {
  const sent: Sent[] = [];
  const deps: ConversationDependencies = {
    admission: { limits, serviceKey },
    db,
    runtime: recordingRuntime(sent),
    signingKey,
  };
  return { deps, sent, serviceKey };
}

// A host seeded the way sign-in leaves it, without the Auth round trip.
async function host() {
  const userId = randomUUID();
  const email = `host-${userId}@example.test`;
  await db`insert into auth.users (id, email) values (${userId}, ${email})`;
  const [account] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;
  await db`
    insert into app.google_identities (google_subject, host_account_id, auth_user_id, email)
    values (${`sub-${randomUUID()}`}, ${account!.id}, ${userId}, ${email})
  `;
  return { hostAccountId: account!.id, userId };
}

async function inputs(hostAccountId: string) {
  return db<{ fingerprint: string; message: string; protected_fingerprint: string | null }[]>`
    select i.message, i.fingerprint, i.protected_fingerprint
    from app.conversation_inputs i join app.discussions d on d.id = i.discussion_id
    where d.principal_id = ${hostAccountId}
    order by i.accepted_at
  `;
}

async function window(scope: string, key: string, kind: "minute" | "hour") {
  const [row] = await db<{ count: number }[]>`
    select count from app.admission_windows where scope = ${scope} and scope_key = ${key} and window_kind = ${kind}
  `;
  return row?.count ?? 0;
}

function send(deps: ConversationDependencies, userId: string, message: string, clientInputId = randomUUID()) {
  return acceptHostMessage(deps, userId, { clientInputId, message });
}

describe("conversation admission", () => {
  it("accepts only the remaining host allowance from concurrent inputs", async () => {
    const { deps } = dependencies({ scopeMinute: 3 });
    const { hostAccountId, userId } = await host();

    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => send(deps, userId, `Message ${index}`)));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(3);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(3);
    expect(rejected.every((outcome) => (outcome as PromiseRejectedResult).reason instanceof AdmissionLimitError)).toBe(true);
    expect(await inputs(hostAccountId)).toHaveLength(3);
    expect(await window("host", hostAccountId, "minute")).toBe(3);
  });

  it("accepts only the remaining service allowance across hosts", async () => {
    const { deps, serviceKey } = dependencies({ serviceMinute: 4 });
    const hosts = [await host(), await host(), await host()];

    const outcomes = await Promise.allSettled(
      hosts.flatMap((owner) => [1, 2].map((index) => send(deps, owner.userId, `Hello ${index}`))),
    );

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(4);
    expect(await window("service", serviceKey, "minute")).toBe(4);
    const stored = await Promise.all(hosts.map(async (owner) => (await inputs(owner.hostAccountId)).length));
    expect(stored.reduce((sum, count) => sum + count, 0)).toBe(4);
  });

  it("enforces the hour window too", async () => {
    const { deps } = dependencies({ scopeHour: 2 });
    const { userId } = await host();

    await send(deps, userId, "one");
    await send(deps, userId, "two");
    await expect(send(deps, userId, "three")).rejects.toBeInstanceOf(AdmissionLimitError);
  });

  it("returns an exact retry's receipt at the limit without charging", async () => {
    const { deps, serviceKey } = dependencies({ scopeMinute: 2 });
    const { hostAccountId, userId } = await host();
    const clientInputId = randomUUID();

    const first = await send(deps, userId, "Tuesday works.", clientInputId);
    await send(deps, userId, "Or Wednesday.");
    const retry = await send(deps, userId, "Tuesday works.", clientInputId);

    expect(retry.inputId).toBe(first.inputId);
    expect(await window("host", hostAccountId, "minute")).toBe(2);
    expect(await window("service", serviceKey, "minute")).toBe(2);
    await expect(send(deps, userId, "Something new")).rejects.toBeInstanceOf(AdmissionLimitError);
  });

  it("starts a fresh window after expiry, so the same message can be sent again", async () => {
    const { deps } = dependencies({ scopeMinute: 1 });
    const { hostAccountId, userId } = await host();
    const clientInputId = randomUUID();

    await send(deps, userId, "First.");
    await expect(send(deps, userId, "Second.", clientInputId)).rejects.toBeInstanceOf(AdmissionLimitError);
    await db`
      update app.admission_windows set window_start = window_start - interval '61 seconds'
      where scope = 'host' and scope_key = ${hostAccountId} and window_kind = 'minute'
    `;

    await expect(send(deps, userId, "Second.", clientInputId)).resolves.toMatchObject({ inputId: expect.any(String) });
    expect(await window("host", hostAccountId, "minute")).toBe(1);
  });

  it("answers a limited browser message with HTTP 429 and a retry delay", async () => {
    const response = chatError(new AdmissionLimitError(42));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toEqual({ code: "rate_limited", error: ADMISSION_LIMITED_MESSAGE, retryAfterSeconds: 42 });
  });

  it("serializes admission inside the caller's transaction for other scopes", async () => {
    const intake = randomUUID();
    const serviceKey = `test:${randomUUID()}`;
    const admit = () => db.begin((tx) => admitConversationInput(tx, { key: intake, scope: "intake" }, { limits: { scopeMinute: 2 }, serviceKey }));

    const outcomes = await Promise.allSettled([admit(), admit(), admit()]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(await window("intake", intake, "minute")).toBe(2);
  });
});

describe("credential redaction in the message path", () => {
  const uuid = "6f1c2b9e-0d4a-4f1e-8a59-3c3a4b5d6e7f";

  it("stores and sends only the protected text", async () => {
    const { deps, sent } = dependencies();
    const { hostAccountId, userId } = await host();
    const original = `Meet Friday 2pm at Gangnam. My link: https://findmeatime.com/booking/${uuid}?code=99999`;

    await send(deps, userId, original);

    const [stored] = await inputs(hostAccountId);
    expect(stored!.message).toBe("Meet Friday 2pm at Gangnam. My link: [removed credential]?code=[removed credential]");
    expect(stored!.fingerprint).toBe(messageFingerprint(stored!.message));
    expect(stored!.protected_fingerprint).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(uuid);
    expect(sent.map((entry) => entry.message)).toEqual([stored!.message]);
  });

  it("rejects a changed secret under the same retry key without a second input or charge", async () => {
    const { deps, serviceKey } = dependencies();
    const { hostAccountId, userId } = await host();
    const clientInputId = randomUUID();

    await send(deps, userId, "Use Bearer first-111111 for the call", clientInputId);
    await expect(send(deps, userId, "Use Bearer second-22222 for the call", clientInputId)).rejects.toMatchObject({
      code: "retry_conflict",
    });
    await expect(send(deps, userId, "Use Bearer first-111111 for the call", clientInputId)).resolves.toBeDefined();

    expect(await inputs(hostAccountId)).toHaveLength(1);
    expect(await window("service", serviceKey, "minute")).toBe(1);
  });

  it("protects an input admitted before the migration when it is delivered, keeping its retry identity", async () => {
    const { deps, sent } = dependencies();
    const { hostAccountId, userId } = await host();
    const original = `Old message with Bearer legacy-123456 and /booking/${uuid}`;
    const clientInputId = randomUUID();
    const discussionId = await db.begin((tx) => lockSetupDiscussion(tx, hostAccountId));
    await db`
      insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, message)
      values (${discussionId}, ${clientInputId}, ${messageFingerprint(original)}, ${original})
    `;

    // The exact retry still matches by its original fingerprint and delivers it.
    await send(deps, userId, original, clientInputId);
    await deliverNext(deps, hostAccountId, discussionId);

    expect(sent.map((entry) => entry.message)).toEqual(["Old message with Bearer [removed credential] and [removed credential]"]);
    await expect(send(deps, userId, `${original}!`, clientInputId)).rejects.toMatchObject({ code: "retry_conflict" });
  });
  it("removes a bare UUID from requester input, and keeps it in host input", async () => {
    const { deps, sent } = dependencies();
    const request = await createTestRequest(db);
    const original = `My booking is ${uuid}, can we move it?`;

    await acceptGuestMessage(deps, { id: request.requestId, type: "requester_request" }, { clientInputId: randomUUID(), message: original });

    const [stored] = await db<{ message: string }[]>`
      select i.message from app.conversation_inputs i join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${request.requestId}
    `;
    expect(stored!.message).toBe("My booking is [removed credential], can we move it?");
    expect(sent.map((entry) => entry.message)).toEqual([stored!.message]);

    const { hostAccountId, userId } = await host();
    await send(deps, userId, `Calendar ${uuid} is mine`);
    expect((await inputs(hostAccountId))[0]!.message).toBe(`Calendar ${uuid} is mine`);
  });
});

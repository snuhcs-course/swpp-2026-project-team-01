import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { createImessageSendHandler, IMESSAGE_SEND_JOB, type ImessageSendDependencies, recordOutbound } from "../../lib/server/imessage-outbox";
import { photonConfig } from "../../lib/server/photon";
import { imessageHash } from "../../lib/server/photon-receiver";
import { sealToken } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { newSender } from "./support/photon";
import { newHostAccount } from "./support/ready-host";
import { runJob, testTokenKey } from "./support/requests";

// The outbox and the imessage_send job against the local stack and the Photon
// stand-in (host-imessage-channel task 2.4): a queued message is frozen, marked
// dispatching and sent once; a refusal is failed; a refused connection returns it
// to the queue and fails the attempt; a lost answer is uncertain and never sent
// again; a host-private message is suppressed once its binding ends; and a
// denied environment touches nothing.

const db = testDatabase();
let photon: FakePhoton;

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

const runtime: ConversationRuntime = {
  createSession: async () => "unused",
  readEvents: () => (async function* () {})(),
  readRecordedEvents: () => (async function* () {})(),
  sendMessage: async () => undefined,
};

function deps(overrides: Partial<ImessageSendDependencies> = {}): ImessageSendDependencies {
  return {
    config: { ...photonConfig({}), apiUrl: photon.baseUrl, lineNumber: "+15550001111" },
    db,
    env: {},
    origin: "http://localhost:3000",
    runtime,
    signingKey: "x".repeat(40),
    tokenKeys: [testTokenKey],
    ...overrides,
  };
}

async function bound(hostAccountId: string, address: string) {
  const sealed = sealToken(testTokenKey, address, "imessage_binding:test");
  const [row] = await db<{ id: string }[]>`
    insert into app.imessage_bindings (host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
    values (${hostAccountId}, ${imessageHash(testTokenKey, "sender", address)}, ${sealed.ciphertext}, ${sealed.keyId})
    returning id
  `;
  return row!.id;
}

async function queue(text: string, options: { bindingId?: string; hostAccountId?: string; address?: string } = {}) {
  const address = options.address ?? newSender();
  const { id } = await db.begin((tx) =>
    recordOutbound(tx, {
      bindingId: options.bindingId ?? null,
      dedupeKey: `test:${crypto.randomUUID()}`,
      hostAccountId: options.hostAccountId ?? null,
      kind: "command",
      recipient: { address, spaceId: `any;-;${address}` },
      recipientHash: imessageHash(testTokenKey, "sender", address),
      text,
      tokenKey: testTokenKey,
    }),
  );
  return { address, id };
}

// A loopback URL nothing listens on, so a connection is refused.
async function closedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

async function run(outboxId: string, d: ImessageSendDependencies = deps()) {
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${outboxId}`}`;
  await db`update app.jobs set run_after = now() where id = ${job!.id}`;
  return runJob(db, job!.id, createImessageSendHandler(() => d));
}

async function rowOf(id: string) {
  const [row] = await db<
    { state: string; failure_category: string | null; provider_message_id: string | null; text_ciphertext: string | null; recipient_ciphertext: string | null }[]
  >`select state, failure_category, provider_message_id, text_ciphertext, recipient_ciphertext from app.imessage_outbox where id = ${id}`;
  return row!;
}

describe("imessage_send", () => {
  it("sends a queued message once, records it accepted and clears its sealed values", async () => {
    const { address, id } = await queue("Linked. Send help for what I can do here.");
    expect(await rowOf(id)).toMatchObject({ state: "queued" });
    expect((await rowOf(id)).text_ciphertext).not.toContain("Linked");

    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ recipient_ciphertext: null, state: "accepted", text_ciphertext: null });
    expect(photon.sentTo(address)).toEqual([
      expect.objectContaining({ content: { kind: "text", text: "Linked. Send help for what I can do here." }, idempotencyKey: id }),
    ]);
    expect(await run(id)).toBe("not_due");
  });

  it("records a refusal as failed with its category", async () => {
    const { id } = await queue("Hello");
    photon.nextSend({ category: "not_imessage", status: 422 });
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ failure_category: "not_imessage", state: "failed" });
  });

  it("returns a message to the queue when Photon is unreachable, and fails it after the last attempt", async () => {
    const { id } = await queue("Hello");
    const unreachable = deps({ config: { ...photonConfig({}), apiUrl: await closedPort(), lineNumber: "" } });
    expect(await run(id, unreachable)).toBe("failed");
    expect(await rowOf(id)).toMatchObject({ failure_category: "unavailable", state: "queued" });

    await db`update app.jobs set attempts = max_attempts - 1 where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${id}`}`;
    expect(await run(id, unreachable)).toBe("exhausted");
    expect(await rowOf(id)).toMatchObject({ failure_category: "attempts_exhausted", state: "failed", text_ciphertext: null });
  });

  it("records a lost answer as uncertain and never sends it again", async () => {
    const { address, id } = await queue("Your proposal awaits approval.");
    photon.nextSend("drop");
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ failure_category: "lost_answer", state: "uncertain" });
    expect(photon.sentTo(address)).toHaveLength(1);
  });

  it("makes a message found dispatching uncertain rather than sending it twice", async () => {
    const { address, id } = await queue("Hello");
    await db`update app.imessage_outbox set state = 'dispatching' where id = ${id}`;
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ state: "uncertain" });
    expect(photon.sentTo(address)).toHaveLength(0);
  });

  it("suppresses a host-private message whose binding ended before dispatch", async () => {
    const hostAccountId = await newHostAccount(db);
    const address = newSender();
    const bindingId = await bound(hostAccountId, address);
    const { id } = await queue("Private summary", { address, bindingId, hostAccountId });
    await db`update app.imessage_bindings set state = 'unlinked', ended_at = now(), sender_ciphertext = null where id = ${bindingId}`;

    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ failure_category: "unlinked", state: "suppressed" });
    expect(photon.sentTo(address)).toHaveLength(0);
  });

  it("touches nothing in a denied environment", async () => {
    const { address, id } = await queue("Hello");
    const preview = deps({ env: { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" } });
    expect(await run(id, preview)).toBe("failed");
    expect(await rowOf(id)).toMatchObject({ failure_category: null, state: "queued" });
    expect(photon.sentTo(address)).toHaveLength(0);
  });
});

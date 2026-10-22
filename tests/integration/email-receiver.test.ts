import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  EMAIL_RECEIPT_JOB,
  receiveAgentMailWebhook,
  receiverConfigFromEnvironment,
  type ReceiverDependencies,
  secretFingerprint,
} from "../../lib/server/agentmail-receiver";
import { runAdmin } from "../../lib/server/operator";
import { svixSignature } from "../../lib/server/svix";
import { LOCAL_DATABASE_URL, testDatabase } from "./support/database";

// The AgentMail receiver against the local stack (requester-email-ingress; task
// 2.2): a received message is stored as one receipt and one job before 204, a
// retry or a concurrent duplicate reuses them, a changed retry is refused with
// 409 and changes nothing, a disabled, replaced, unknown or re-keyed receiver
// and a bad or stale signature store nothing, other event types are acknowledged
// and dropped, and the receipt holds nothing from the message itself.

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

function newSecret() {
  return `whsec_${randomBytes(24).toString("base64")}`;
}

async function register(inbox: string, secret: string) {
  const [row] = await db<{ id: string }[]>`
    select result_receiver_id as id
    from app.operator_register_email_receiver(${inbox}, ${`ep_${randomUUID().slice(0, 8)}`}, ${secretFingerprint(secret)}, 'tester', 'local')
  `;
  return row!.id;
}

function fixture() {
  const inbox = `inbox-${randomUUID().slice(0, 8)}@agentmail.test`;
  const secret = newSecret();
  const deps: ReceiverDependencies = { config: { inboxId: inbox, secret }, db };
  return { deps, inbox, secret };
}

function payload(inbox: string, overrides: { event?: string; thread?: string; message?: string; type?: string } = {}) {
  return JSON.stringify({
    event_id: overrides.event ?? `evt_${randomUUID()}`,
    event_type: overrides.type ?? "message.received",
    message: {
      extracted_text: "Can we meet next week?",
      from: "Guest <guest@example.test>",
      inbox_id: inbox,
      message_id: overrides.message ?? `<${randomUUID()}@example.test>`,
      subject: "Meeting with @alice",
      thread_id: overrides.thread ?? `thr_${randomUUID()}`,
      to: [inbox],
    },
    thread: {},
    type: "event",
  });
}

function signed(secret: string, body: string, options: { id?: string; at?: number } = {}) {
  const id = options.id ?? `msg_${randomUUID()}`;
  const timestamp = String(options.at ?? Math.floor(Date.now() / 1000));
  return new Request("http://localhost/agentmail/webhooks/x", {
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-signature": `v1,${svixSignature(secret, id, timestamp, body)}`,
      "svix-timestamp": timestamp,
    },
    method: "POST",
  });
}

async function receipts(inbox: string) {
  return db<{ id: string; event_id: string; delivery_id: string; thread_id: string; message_id: string; payload_sha256: string }[]>`
    select id, event_id, delivery_id, thread_id, message_id, payload_sha256 from app.email_receipts where inbox_id = ${inbox}
  `;
}

async function jobsFor(receiptIds: readonly string[]) {
  return db<{ payload: { receiptId: string } }[]>`
    select payload from app.jobs where kind = ${EMAIL_RECEIPT_JOB} and payload ->> 'receiptId' = any(${receiptIds as string[]})
  `;
}

describe("AgentMail receiver", () => {
  it("stores one receipt and one job before acknowledging", async () => {
    const { deps, inbox, secret } = fixture();
    const receiver = await register(inbox, secret);
    const body = payload(inbox);

    const id = `msg_${randomUUID()}`;
    const response = await receiveAgentMailWebhook(signed(secret, body, { id }), receiver, () => deps);
    expect(response.status).toBe(204);

    const stored = await receipts(inbox);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.delivery_id).toBe(id);
    const jobs = await jobsFor(stored.map((row) => row.id));
    expect(jobs).toEqual([{ payload: { receiptId: stored[0]!.id } }]);
  });

  it("keeps nothing from the message itself", async () => {
    const { deps, inbox, secret } = fixture();
    const receiver = await register(inbox, secret);
    await receiveAgentMailWebhook(signed(secret, payload(inbox)), receiver, () => deps);

    const [row] = await db<Record<string, unknown>[]>`select * from app.email_receipts where inbox_id = ${inbox}`;
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("guest@example.test");
    expect(stored).not.toContain("Can we meet");
    expect(stored).not.toContain("@alice");
    expect(Object.keys(row!).sort()).toEqual(
      ["delivery_id", "event_id", "event_type", "id", "inbox_id", "message_id", "outcome", "payload_sha256", "processed_at", "received_at", "receiver_id", "thread_id"].sort(),
    );
  });

  it("resolves concurrent and retried deliveries to one receipt and one job", async () => {
    const { deps, inbox, secret } = fixture();
    const receiver = await register(inbox, secret);
    const body = payload(inbox);
    const at = Math.floor(Date.now() / 1000);
    const id = `msg_${randomUUID()}`;

    const answers = await Promise.all(
      Array.from({ length: 4 }, () => receiveAgentMailWebhook(signed(secret, body, { at, id }), receiver, () => deps)),
    );
    expect(answers.map((answer) => answer.status)).toEqual([204, 204, 204, 204]);

    // The response was lost and AgentMail retries the same delivery later.
    const retried = await receiveAgentMailWebhook(signed(secret, body, { id }), receiver, () => deps);
    expect(retried.status).toBe(204);

    const stored = await receipts(inbox);
    expect(stored).toHaveLength(1);
    expect(await jobsFor(stored.map((row) => row.id))).toHaveLength(1);
  });

  it("refuses a reused identity with changed evidence and changes nothing", async () => {
    const { deps, inbox, secret } = fixture();
    const receiver = await register(inbox, secret);
    const event = `evt_${randomUUID()}`;
    const message = `<${randomUUID()}@example.test>`;
    const thread = `thr_${randomUUID()}`;
    const delivery = `msg_${randomUUID()}`;

    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox, { event, message, thread }), { id: delivery }), receiver, () => deps)).status).toBe(204);
    const before = await receipts(inbox);

    const changes = [
      // The same event with another message.
      payload(inbox, { event, thread }),
      // The same event in another thread.
      payload(inbox, { event, message, thread: `thr_${randomUUID()}` }),
      // The same message under another event.
      payload(inbox, { message, thread }),
    ];

    for (const body of changes) {
      expect((await receiveAgentMailWebhook(signed(secret, body), receiver, () => deps)).status).toBe(409);
    }

    // The same delivery ID carrying another event.
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox), { id: delivery }), receiver, () => deps)).status).toBe(409);

    expect(await receipts(inbox)).toEqual(before);
    expect(await jobsFor(before.map((row) => row.id))).toHaveLength(1);
  });

  it("refuses disabled, replaced, unknown and re-keyed receivers", async () => {
    const { deps, inbox, secret } = fixture();
    const first = await register(inbox, secret);
    const second = await register(inbox, secret);

    // Registering again disabled the first receiver.
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox)), first, () => deps)).status).toBe(404);
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox)), randomUUID(), () => deps)).status).toBe(404);
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox)), "not-a-uuid", () => deps)).status).toBe(404);

    // The deployment's secret was replaced: the registration no longer matches.
    const rotated = newSecret();
    const rekeyed: ReceiverDependencies = { config: { inboxId: inbox, secret: rotated }, db };
    expect((await receiveAgentMailWebhook(signed(rotated, payload(inbox)), second, () => rekeyed)).status).toBe(404);

    // Another inbox configured for this deployment.
    const elsewhere: ReceiverDependencies = { config: { inboxId: "other@agentmail.test", secret }, db };
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox)), second, () => elsewhere)).status).toBe(404);

    await db`select * from app.operator_disable_email_receiver(${second}, 'tester')`;
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox)), second, () => deps)).status).toBe(404);

    expect(await receipts(inbox)).toHaveLength(0);
  });

  it("refuses a wrong or stale signature before reading the payload", async () => {
    const { deps, inbox, secret } = fixture();
    const receiver = await register(inbox, secret);

    expect((await receiveAgentMailWebhook(signed(newSecret(), payload(inbox)), receiver, () => deps)).status).toBe(401);
    const stale = Math.floor(Date.now() / 1000) - 6 * 60;
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox), { at: stale }), receiver, () => deps)).status).toBe(401);
    expect((await receiveAgentMailWebhook(signed(secret, "not json"), receiver, () => deps)).status).toBe(400);

    const unsigned = new Request("http://localhost/agentmail/webhooks/x", { body: payload(inbox), method: "POST" });
    expect((await receiveAgentMailWebhook(unsigned, receiver, () => deps)).status).toBe(401);

    expect(await receipts(inbox)).toHaveLength(0);
  });

  it("acknowledges other event types without storing them", async () => {
    const { deps, inbox, secret } = fixture();
    const receiver = await register(inbox, secret);

    for (const type of ["message.sent", "message.delivered", "message.received.spam", "message.received.unauthenticated"]) {
      expect((await receiveAgentMailWebhook(signed(secret, payload(inbox, { type })), receiver, () => deps)).status).toBe(204);
    }

    // A received message for another inbox is not this receiver's.
    expect((await receiveAgentMailWebhook(signed(secret, payload("other@agentmail.test")), receiver, () => deps)).status).toBe(404);
    expect(await receipts(inbox)).toHaveLength(0);
  });

  it("caps a body without a declared length, and accepts the inbox in any case", async () => {
    const { deps, inbox, secret } = fixture();
    const receiver = await register(inbox, secret);
    const huge = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 300; index += 1) controller.enqueue(new Uint8Array(1024).fill(32));
        controller.close();
      },
    });
    const streamed = new Request("http://localhost/agentmail/webhooks/x", { body: huge, duplex: "half", method: "POST" } as RequestInit);
    expect((await receiveAgentMailWebhook(streamed, receiver, () => deps)).status).toBe(413);

    const upper: ReceiverDependencies = { ...deps, config: receiverConfigFromEnvironment({ AGENTMAIL_INBOX_ID: inbox.toUpperCase(), AGENTMAIL_WEBHOOK_SECRET: secret }) };
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox)), receiver, () => upper)).status).toBe(204);
  });

  it("is unavailable without an inbox or secret configured", async () => {
    const { inbox, secret } = fixture();
    const receiver = await register(inbox, secret);
    const unconfigured: ReceiverDependencies = { config: { inboxId: "", secret: "" }, db };
    expect((await receiveAgentMailWebhook(signed(secret, payload(inbox)), receiver, () => unconfigured)).status).toBe(404);
  });
});

describe("email-receiver operator commands", () => {
  function admin(env: Record<string, string | undefined>) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      deps: { env, interactive: false, prompt: async () => "", stderr: (line: string) => err.push(line), stdout: (line: string) => out.push(line) },
      err,
      out,
    };
  }

  it("registers, replaces and disables a receiver with only the secret's fingerprint", async () => {
    const inbox = `ops-${randomUUID().slice(0, 8)}@agentmail.test`;
    const secret = newSecret();
    const env = { AGENTMAIL_WEBHOOK_SECRET: secret, DATABASE_URL: process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL };

    const first = admin(env);
    expect(await runAdmin(["email-receiver", "register", "--inbox", inbox, "--webhook", "ep_one", "--operator", "ops", "--local", "--yes"], first.deps)).toBe(0);
    const second = admin(env);
    expect(await runAdmin(["email-receiver", "register", "--inbox", inbox, "--webhook", "ep_two", "--operator", "ops", "--local", "--yes"], second.deps)).toBe(0);

    const rows = await db<{ id: string; state: string; secret_fingerprint: string; disabled_by: string | null; environment: string }[]>`
      select id, state, secret_fingerprint, disabled_by, environment from app.email_receivers where inbox_id = ${inbox} order by created_at
    `;
    expect(rows.map((row) => row.state)).toEqual(["disabled", "enabled"]);
    expect(rows[0]!.disabled_by).toBe("ops");
    expect(rows.every((row) => row.secret_fingerprint === secretFingerprint(secret) && row.environment === "local")).toBe(true);
    expect([...first.out, ...second.out].join("\n")).not.toContain(secret);

    const disable = admin(env);
    expect(await runAdmin(["email-receiver", "disable", "--receiver", rows[1]!.id, "--operator", "ops", "--local", "--yes"], disable.deps)).toBe(0);
    const [after] = await db<{ state: string }[]>`select state from app.email_receivers where id = ${rows[1]!.id}`;
    expect(after!.state).toBe("disabled");

    const unknown = admin(env);
    expect(await runAdmin(["email-receiver", "disable", "--receiver", randomUUID(), "--operator", "ops", "--local", "--yes"], unknown.deps)).toBe(1);
    expect(unknown.err.join("\n")).toMatch(/no receiver matches/);
  });
});

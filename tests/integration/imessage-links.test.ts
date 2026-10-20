import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { PhoneLink } from "../../lib/contracts/phone-link";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import {
  createImessageInboundHandler,
  createImessageSendHandler,
  IMESSAGE_INBOUND_JOB,
  IMESSAGE_SEND_JOB,
  readPhoneLink,
  retryPhoneLinkCommand,
  startPhoneLinkCommand,
} from "../../lib/server/imessage-links";
import { ImessageSendError, type ImessageTransport } from "../../lib/server/imessage-transport";
import { claimJobs, type JobHandler, processJob } from "../../lib/server/jobs";
import { createPhotonWebhookHandler, photonSignature } from "../../lib/server/photon-webhook";
import { testDatabase } from "./support/database";
import { newHostAccount } from "./support/ready-host";

// The stored phone check (host-imessage-linking): commands, the send job against
// a transport stand-in, and replies through the signed webhook and its job.

const db = testDatabase();
const env = { IMESSAGE_TRANSPORT: "standin" };
const secret = "s".repeat(64);
const webhookId = "hook-test";

afterAll(async () => {
  await db.end();
});

function phone() {
  return `+8210${String(randomInt(10_000_000, 99_999_999))}`;
}

function run<Input>(host: string, command: CommandDefinition<Input, unknown>, input: unknown) {
  return runCommand({ authenticate: async () => ({ id: host, kind: "host_account" }), db, env }, command, {
    input,
    resourceId: host,
    retryKey: randomUUID(),
  });
}

async function start(host: string, number: string) {
  const outcome = await run(host, startPhoneLinkCommand, { phone: number });
  if (!outcome.ok) throw new Error(`start refused: ${outcome.error.category} ${outcome.error.reason ?? ""}`);
  return outcome.result as PhoneLink;
}

// Runs the due jobs of one kind for this host's links through the given handler.
async function drain(kind: string, handler: JobHandler) {
  await db`update app.jobs set run_after = now() where kind = ${kind} and state = 'pending'`;
  for (const job of await claimJobs(db, { environment: "local", kinds: [kind], limit: 25, owner: "test" })) {
    await processJob(db, job, handler);
  }
}

const sent: string[] = [];
const transport = (outcome: "ok" | "uncertain" | "non_imessage_recipient" = "ok"): ImessageTransport => ({
  send: async (message) => {
    sent.push(message.text);
    if (outcome !== "ok") throw new ImessageSendError(outcome);
    return { line: "+15550100", messageId: randomUUID(), spaceId: `any;-;${message.to}` };
  },
});

function sendJobs(outcome?: "ok" | "uncertain" | "non_imessage_recipient") {
  return drain(IMESSAGE_SEND_JOB, createImessageSendHandler(() => transport(outcome)));
}

const webhook = createPhotonWebhookHandler(() => ({ config: { secret, webhookId }, db }));

async function reply(from: string, text: string, options: { id?: string; type?: string } = {}) {
  const body = JSON.stringify({
    event: "messages",
    message: {
      content: { text, type: "text" },
      direction: "inbound",
      id: options.id ?? `spc-msg-${randomUUID()}`,
      platform: "iMessage",
      sender: { id: from, platform: "iMessage" },
      space: { id: `any;-;${from}`, phone: "+15550100", platform: "iMessage", type: options.type ?? "dm" },
      timestamp: new Date().toISOString(),
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await webhook(
    new Request("http://localhost/api/photon/webhook", {
      body,
      headers: {
        "content-type": "application/json",
        "x-spectrum-signature": photonSignature(secret, timestamp, body),
        "x-spectrum-timestamp": timestamp,
        "x-spectrum-webhook-id": webhookId,
      },
      method: "POST",
    }),
  );
  await drain(IMESSAGE_INBOUND_JOB, createImessageInboundHandler());
  return response;
}

async function view(host: string) {
  return (await readPhoneLink(db, host))!;
}

describe("phone check", () => {
  it("texts the number without the code and connects on the matching reply", async () => {
    const [host, number] = [await newHostAccount(db), phone()];
    const started = await start(host, number);

    expect(started).toMatchObject({ code: null, phone: `•••• ${number.slice(-4)}`, status: "pending", wrongReplies: 0 });

    await sendJobs();
    const out = await view(host);
    expect(out.status).toBe("sent");
    expect(out.code).toMatch(/^\d{2}$/);
    expect(sent.at(-1)).not.toContain(out.code!);

    expect((await reply(number, ` ${out.code} `)).status).toBe(200);
    expect((await view(host)).status).toBe("connected");

    const [stored] = await db<{ body: string | null; state: string }[]>`
      select body, state from app.imessage_inbound_events where sender = ${number}
    `;
    expect(stored).toEqual({ body: null, state: "applied" });
  });

  it("ignores the right number from another phone or a group conversation", async () => {
    const [host, number] = [await newHostAccount(db), phone()];
    await start(host, number);
    await sendJobs();
    const { code } = await view(host);

    await reply(phone(), code!);
    await reply(number, code!, { type: "group" });

    expect(await view(host)).toMatchObject({ status: "sent", wrongReplies: 0 });
  });

  it("applies a webhook delivered twice once", async () => {
    const [host, number] = [await newHostAccount(db), phone()];
    await start(host, number);
    await sendJobs();
    const id = `spc-msg-${randomUUID()}`;

    await reply(number, "00", { id });
    await reply(number, "00", { id });

    expect((await view(host)).wrongReplies).toBe(1);
  });

  it("replaces the number on a wrong reply and locks the check on the third", async () => {
    const [host, number] = [await newHostAccount(db), phone()];
    await start(host, number);
    await sendJobs();
    const first = (await view(host)).code!;

    await reply(number, "hello");
    const second = await view(host);
    expect(second).toMatchObject({ status: "sent", wrongReplies: 1 });
    expect(second.code).not.toBe(first);

    await reply(number, first);
    expect((await view(host)).status).toBe("sent");

    await reply(number, "no");
    const locked = await view(host);
    expect(locked).toMatchObject({ code: null, failure: "too_many_wrong_replies", status: "failed", wrongReplies: 3 });
    expect(locked.retryEligibleAt! - Date.now()).toBeGreaterThan(4 * 60_000);

    const again = await run(host, startPhoneLinkCommand, { phone: number });
    expect(again).toMatchObject({ error: { reason: "retry_not_eligible" }, ok: false });
    const retry = await run(host, retryPhoneLinkCommand, {});
    expect(retry).toMatchObject({ error: { reason: "retry_not_eligible" }, ok: false });
  });

  it("holds an early retry until a minute after the last text", async () => {
    const [host, number] = [await newHostAccount(db), phone()];
    await start(host, number);
    await sendJobs();

    const retried = await run(host, retryPhoneLinkCommand, {});
    expect(retried).toMatchObject({ ok: true, result: { status: "pending" } });

    const sends = await db<{ scheduled_at: Date }[]>`
      select s.scheduled_at from app.imessage_sends s join app.imessage_links l on l.id = s.link_id
      where l.host_account_id = ${host} order by s.scheduled_at
    `;
    expect(sends[1]!.scheduled_at.getTime() - sends[0]!.scheduled_at.getTime()).toBeGreaterThanOrEqual(60_000);
  });

  it("connects a reply to a text whose send result was lost", async () => {
    const [host, number] = [await newHostAccount(db), phone()];
    await start(host, number);
    await sendJobs("uncertain");
    const out = await view(host);

    expect(out.status).toBe("uncertain");
    await reply(number, out.code!);
    expect((await view(host)).status).toBe("connected");
  });

  it("fails a number that does not use iMessage", async () => {
    const [host, number] = [await newHostAccount(db), phone()];
    await start(host, number);
    await sendJobs("non_imessage_recipient");

    expect(await view(host)).toMatchObject({ code: null, failure: "non_imessage_recipient", status: "failed" });
  });

  it("refuses a number linked to another host before texting it", async () => {
    const [alice, bob, number] = [await newHostAccount(db), await newHostAccount(db), phone()];
    await start(alice, number);
    await sendJobs();
    await reply(number, (await view(alice)).code!);

    const refused = await run(bob, startPhoneLinkCommand, { phone: number });
    expect(refused).toMatchObject({ error: { category: "invalid_input", reason: "phone_taken" }, ok: false });
    expect(await readPhoneLink(db, bob)).toBeNull();
  });

  it("refuses a webhook with a bad signature without storing it", async () => {
    const response = await webhook(
      new Request("http://localhost/api/photon/webhook", {
        body: "{}",
        headers: { "x-spectrum-signature": "v0=00", "x-spectrum-timestamp": String(Math.floor(Date.now() / 1000)) },
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
  });
});

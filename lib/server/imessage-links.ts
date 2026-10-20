import { randomInt } from "node:crypto";
import { z } from "zod";
import {
  CODE_TTL_MS,
  LOCKOUT_MS,
  MAX_SENDS_PER_WINDOW,
  MAX_WRONG_REPLIES,
  notifyRequestSchema,
  type NotifyChannel,
  type PhoneLink,
  phoneLinkStartSchema,
  SEND_SPACING_MS,
  SEND_WINDOW_MS,
} from "../contracts/phone-link";
import { CommandError, type CommandDefinition } from "./commands";
import type { Queryable, Transaction } from "./database";
import {
  IMESSAGE_TRANSPORT_REQUIRES,
  ImessageSendError,
  type ImessageTransport,
  imessageTransportFromEnvironment,
} from "./imessage-transport";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";

// The phone check (host-imessage-linking). A host enters a number, Thyme texts
// it, and the screen shows a 2-digit number the host sends back in that text
// conversation; the matching reply links the number. The rules are design §2:
// a number lasts CODE_TTL_MS after its text goes out, texts go out no sooner than
// SEND_SPACING_MS apart, at most MAX_SENDS_PER_WINDOW per SEND_WINDOW_MS per host,
// a wrong reply replaces the number, and MAX_WRONG_REPLIES fail the check for
// LOCKOUT_MS. Every change runs in one transaction under the host's link lock.

export const IMESSAGE_SEND_JOB = "imessage_send";
export const IMESSAGE_INBOUND_JOB = "imessage_inbound";

// The text Thyme sends. It never carries the number to send back: that is shown
// only in the browser that asked, which is what ties the phone to that browser.
export const LINK_TEXT =
  "Thyme here, from Find Me a Time. To connect this number, reply with the 2-digit number shown on your screen. If you didn't ask for this, you can ignore it.";

type StoredStatus = "pending" | "sent" | "uncertain" | "connected" | "failed" | "closed";

type ValidCode = { readonly code: string; readonly expiresAt: string };

export type LinkRow = {
  readonly id: string;
  readonly host_account_id: string;
  readonly phone_e164: string;
  readonly status: StoredStatus;
  readonly valid_codes: ValidCode[];
  readonly code: string | null;
  readonly expires_at: Date;
  readonly retry_eligible_at: Date | null;
  readonly failure: string | null;
  readonly wrong_replies: number;
  readonly revision: number;
};

// ---------------------------------------------------------------------------
// Pure rules

export function maskPhone(e164: string) {
  return `•••• ${e164.slice(-4)}`;
}

// A 2-digit number from 10 to 99 that differs from the one it replaces.
export function newCode(avoid: string | null, pick: (min: number, max: number) => number = randomInt) {
  for (;;) {
    const code = String(pick(10, 100));
    if (code !== avoid) return code;
  }
}

// When the next text may go out, and whether the window still allows one: a
// request is held until SEND_SPACING_MS after the host's last text, and the
// window counts the texts scheduled within SEND_WINDOW_MS of now.
export function planSend(scheduled: readonly Date[], now: Date) {
  const last = scheduled.reduce<number | null>((latest, at) => Math.max(latest ?? 0, at.getTime()), null);
  const at = new Date(Math.max(now.getTime(), last === null ? 0 : last + SEND_SPACING_MS));
  const recent = scheduled.filter((when) => now.getTime() - when.getTime() < SEND_WINDOW_MS).length;

  if (recent >= MAX_SENDS_PER_WINDOW) return null;

  // The text being planned is the (recent + 1)th in the window; once that fills
  // the window no further text is allowed for now.
  const retryEligibleAt = recent + 1 < MAX_SENDS_PER_WINDOW ? new Date(at.getTime() + SEND_SPACING_MS) : null;
  return { at, retryEligibleAt };
}

export function unexpiredCodes(codes: readonly ValidCode[], now: Date) {
  return codes.filter((entry) => new Date(entry.expiresAt).getTime() > now.getTime());
}

// What a reply does to a check: connect it, replace the number, fail it, or
// nothing (no number is out yet, or every number has expired).
export type ReplyOutcome =
  | { readonly kind: "connect" }
  | { readonly kind: "ignore" }
  | { readonly kind: "wrong"; readonly code: string; readonly wrongReplies: number }
  | { readonly kind: "lock"; readonly wrongReplies: number; readonly retryEligibleAt: Date };

export function judgeReply(
  link: Pick<LinkRow, "code" | "status" | "valid_codes" | "wrong_replies">,
  body: string,
  now: Date,
  pick?: (min: number, max: number) => number,
): ReplyOutcome {
  if (link.status !== "pending" && link.status !== "sent" && link.status !== "uncertain") return { kind: "ignore" };

  const valid = unexpiredCodes(link.valid_codes, now);

  if (valid.length === 0) return { kind: "ignore" };

  if (valid.some((entry) => entry.code === body.trim())) return { kind: "connect" };

  const wrongReplies = link.wrong_replies + 1;

  if (wrongReplies >= MAX_WRONG_REPLIES) {
    return { kind: "lock", retryEligibleAt: new Date(now.getTime() + LOCKOUT_MS), wrongReplies };
  }

  return { code: newCode(link.code, pick), kind: "wrong", wrongReplies };
}

// The screens' view of a stored check. "expired" is derived: a check whose text
// is out reports it once the newest number has run out.
export function linkView(link: LinkRow, now: Date): PhoneLink {
  const out = link.status === "sent" || link.status === "uncertain";
  const status =
    link.status === "closed"
      ? "expired"
      : out && now.getTime() >= link.expires_at.getTime()
        ? "expired"
        : link.status;

  return {
    code: link.status === "connected" ? null : link.code,
    expiresAt: link.expires_at.getTime(),
    failure: link.failure,
    phone: maskPhone(link.phone_e164),
    retryEligibleAt: link.retry_eligible_at?.getTime() ?? null,
    status,
    wrongReplies: link.wrong_replies,
  };
}

// ---------------------------------------------------------------------------
// Storage

const LINK_COLUMNS = `id, host_account_id, phone_e164, status, valid_codes, code, expires_at, retry_eligible_at,
  failure, wrong_replies, revision`;

async function databaseNow(tx: Queryable) {
  const [row] = await tx<{ now: Date }[]>`select now() as now`;
  return row!.now;
}

async function lockHostLinks(tx: Transaction, hostAccountId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_link:${hostAccountId}`}, 0))`;
}

async function openLink(tx: Queryable, hostAccountId: string) {
  const [row] = await tx.unsafe<LinkRow[]>(
    `select ${LINK_COLUMNS} from app.imessage_links where host_account_id = $1 and status <> 'closed'`,
    [hostAccountId],
  );
  return row ?? null;
}

// The host's current check for the screens: the open one, else nothing.
export async function readPhoneLink(db: Queryable, hostAccountId: string) {
  const [row, now] = await Promise.all([openLink(db, hostAccountId), databaseNow(db)]);
  return row ? linkView(row, now) : null;
}

export async function hasLinkedPhone(db: Queryable, hostAccountId: string) {
  const [row] = await db<{ linked: boolean }[]>`
    select exists (
      select 1 from app.imessage_links where host_account_id = ${hostAccountId} and status = 'connected'
    ) as linked
  `;
  return row!.linked;
}

// Queues a text for the check, or puts the phone off when the window is full.
async function scheduleSend(tx: Transaction, link: { id: string; host_account_id: string }, now: Date) {
  const sends = await tx<{ scheduled_at: Date }[]>`
    select scheduled_at from app.imessage_sends
    where host_account_id = ${link.host_account_id} and scheduled_at > ${now}::timestamptz - make_interval(secs => ${SEND_WINDOW_MS / 1000})
  `;
  const plan = planSend(
    sends.map((send) => send.scheduled_at),
    now,
  );

  if (!plan) return null;

  const [send] = await tx<{ id: string }[]>`
    insert into app.imessage_sends (link_id, host_account_id, scheduled_at)
    values (${link.id}, ${link.host_account_id}, ${plan.at})
    returning id
  `;

  await publishJob(tx, {
    dedupeKey: `${IMESSAGE_SEND_JOB}:${send!.id}`,
    kind: IMESSAGE_SEND_JOB,
    // A send is not retried: a second attempt could text the host twice.
    maxAttempts: 1,
    payload: { sendId: send!.id },
    runAfter: plan.at,
  });

  return plan;
}

// ---------------------------------------------------------------------------
// Commands

async function phoneHeldElsewhere(tx: Transaction, hostAccountId: string, phone: string) {
  const [row] = await tx<{ held: boolean }[]>`
    select exists (
      select 1 from app.imessage_links
      where phone_e164 = ${phone} and status = 'connected' and host_account_id <> ${hostAccountId}
    ) as held
  `;
  return row!.held;
}

// POST /api/host/imessage/connection { phone }: starts a check for the number,
// closing the host's previous unfinished one. A number linked to another host is
// refused before any text goes out.
export const startPhoneLinkCommand: CommandDefinition<z.infer<typeof phoneLinkStartSchema>, PhoneLink> = {
  input: phoneLinkStartSchema,
  operation: "imessage.start_link",
  requires: IMESSAGE_TRANSPORT_REQUIRES,
  run: async (tx, { actor, input }) => {
    await lockHostLinks(tx, actor.id);
    const now = await databaseNow(tx);
    const current = await openLink(tx, actor.id);

    if (current?.status === "connected") throw new CommandError("invalid_input", { reason: "phone_already_linked" });
    // Entering the same number again does not end a wrong-reply lockout early.
    if (
      current?.failure === "too_many_wrong_replies" &&
      current.phone_e164 === input.phone &&
      current.retry_eligible_at !== null &&
      current.retry_eligible_at.getTime() > now.getTime()
    ) {
      throw new CommandError("invalid_input", { reason: "retry_not_eligible" });
    }
    if (await phoneHeldElsewhere(tx, actor.id, input.phone)) throw new CommandError("invalid_input", { reason: "phone_taken" });

    if (current) {
      await tx`
        update app.imessage_links set status = 'closed', closed_at = now(), updated_at = now(), revision = revision + 1
        where id = ${current.id}
      `;
    }

    const [link] = await tx<{ id: string; host_account_id: string }[]>`
      insert into app.imessage_links (host_account_id, phone_e164, expires_at)
      values (${actor.id}, ${input.phone}, ${now}::timestamptz + make_interval(secs => ${CODE_TTL_MS / 1000}))
      returning id, host_account_id
    `;
    const plan = await scheduleSend(tx, link!, now);

    if (!plan) throw new CommandError("invalid_input", { reason: "retry_not_eligible" });

    await tx`
      update app.imessage_links
      set expires_at = ${plan.at}::timestamptz + make_interval(secs => ${CODE_TTL_MS / 1000}),
          retry_eligible_at = ${plan.retryEligibleAt}
      where id = ${link!.id}
    `;

    return linkView((await openLink(tx, actor.id))!, now);
  },
};

// POST /api/host/imessage/connection/retry: another text for the open check. It is
// never refused for being early, only when no more texts are allowed or, after
// too many wrong replies, before the lockout ends. A retry after a lockout starts
// the wrong-reply count again with a new number.
export const retryPhoneLinkCommand: CommandDefinition<Record<string, never>, PhoneLink> = {
  input: z.strictObject({}),
  operation: "imessage.retry_link",
  requires: IMESSAGE_TRANSPORT_REQUIRES,
  run: async (tx, { actor }) => {
    await lockHostLinks(tx, actor.id);
    const now = await databaseNow(tx);
    const link = await openLink(tx, actor.id);

    if (!link || link.status === "connected") throw new CommandError("invalid_input");

    const locked = link.failure === "too_many_wrong_replies";

    if (link.retry_eligible_at === null || (locked && link.retry_eligible_at.getTime() > now.getTime())) {
      throw new CommandError("invalid_input", { reason: "retry_not_eligible" });
    }

    const plan = await scheduleSend(tx, link, now);

    if (!plan) {
      await tx`
        update app.imessage_links set retry_eligible_at = null, updated_at = now(), revision = revision + 1
        where id = ${link.id}
      `;
      throw new CommandError("invalid_input", { reason: "retry_not_eligible" });
    }

    // Earlier numbers keep working until they expire, unless the check failed:
    // then the retry starts over with only the number the new text brings.
    const restart = link.status === "failed";

    await tx`
      update app.imessage_links
      set status = 'pending',
          failure = null,
          retry_eligible_at = ${plan.retryEligibleAt},
          wrong_replies = case when ${restart} then 0 else wrong_replies end,
          valid_codes = case when ${restart} then '[]'::jsonb else valid_codes end,
          code = case when ${restart} then null else code end,
          expires_at = ${plan.at}::timestamptz + make_interval(secs => ${CODE_TTL_MS / 1000}),
          updated_at = now(), revision = revision + 1
      where id = ${link.id}
    `;

    return linkView((await openLink(tx, actor.id))!, now);
  },
};

// POST /api/host/imessage/notify { channel }: hear when texting works again.
export const notifyWhenBackCommand: CommandDefinition<z.infer<typeof notifyRequestSchema>, { channel: NotifyChannel }> = {
  input: notifyRequestSchema,
  operation: "imessage.notify_when_back",
  run: async (tx, { actor, input }) => {
    const link = await openLink(tx, actor.id);

    if (input.channel === "sms" && !link) throw new CommandError("invalid_input");

    await tx`
      insert into app.imessage_notify_requests (host_account_id, link_id, channel)
      values (${actor.id}, ${link?.id ?? null}, ${input.channel})
      on conflict (host_account_id, channel) where notified_at is null do nothing
    `;

    return { channel: input.channel };
  },
};

// ---------------------------------------------------------------------------
// Jobs

async function lockedLink(tx: Transaction, linkId: string) {
  const [row] = await tx.unsafe<LinkRow[]>(`select ${LINK_COLUMNS} from app.imessage_links where id = $1`, [linkId]);
  if (!row) return null;
  await lockHostLinks(tx, row.host_account_id);
  const [locked] = await tx.unsafe<LinkRow[]>(`select ${LINK_COLUMNS} from app.imessage_links where id = $1 for update`, [
    linkId,
  ]);
  return locked ?? null;
}

// The newest send of a check is the one whose outcome the screen shows.
async function isNewestSend(tx: Transaction, linkId: string, sendId: string) {
  const [row] = await tx<{ id: string }[]>`
    select id from app.imessage_sends where link_id = ${linkId} order by scheduled_at desc, created_at desc limit 1
  `;
  return row?.id === sendId;
}

// Sends one queued text. A text that went out, or may have, brings a new number
// valid for CODE_TTL_MS; a refused text fails the check with the provider's
// reason. A text for a check that was closed or connected meanwhile is skipped.
export function createImessageSendHandler(
  load: () => ImessageTransport | null = () => imessageTransportFromEnvironment(),
  pick?: (min: number, max: number) => number,
): JobHandler {
  const failed = async (tx: Transaction, sendId: string, failure: string) => {
    const [send] = await tx<{ link_id: string }[]>`
      update app.imessage_sends set state = 'failed', failure = ${failure} where id = ${sendId} returning link_id
    `;
    if (!send) return;
    const link = await lockedLink(tx, send.link_id);
    if (!link || (link.status !== "pending" && link.status !== "sent" && link.status !== "uncertain")) return;
    if (!(await isNewestSend(tx, link.id, sendId))) return;
    await tx`
      update app.imessage_links set status = 'failed', failure = ${failure}, updated_at = now(), revision = revision + 1
      where id = ${link.id}
    `;
  };

  const handler: JobHandler = async (tx, job: ClaimedJob) => {
    const sendId = typeof job.payload.sendId === "string" ? job.payload.sendId : null;
    const [send] = sendId
      ? await tx<{ id: string; link_id: string; state: string }[]>`
          select id, link_id, state from app.imessage_sends where id = ${sendId} for update
        `
      : [];

    if (!send || send.state !== "queued") return { result: "missing" };

    const link = await lockedLink(tx, send.link_id);

    if (!link || (link.status !== "pending" && link.status !== "sent" && link.status !== "uncertain")) {
      await tx`update app.imessage_sends set state = 'skipped' where id = ${send.id}`;
      return { result: "skipped" };
    }

    const transport = load();

    if (!transport) {
      await failed(tx, send.id, "provider_authentication");
      return { result: "unconfigured" };
    }

    let receipt: { line: string | null; messageId: string | null; spaceId: string | null } | null = null;
    let outcome: "sent" | "uncertain" = "sent";

    try {
      receipt = await transport.send({ text: LINK_TEXT, to: link.phone_e164 });
    } catch (error) {
      if (!(error instanceof ImessageSendError)) {
        await failed(tx, send.id, "provider_rejected");
        return { result: "failed" };
      }

      if (error.failure !== "uncertain") {
        await failed(tx, send.id, error.failure);
        return { result: "failed" };
      }

      outcome = "uncertain";
    }

    const now = await databaseNow(tx);
    const code = newCode(link.code, pick);
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    const codes = [...unexpiredCodes(link.valid_codes, now), { code, expiresAt: expiresAt.toISOString() }];

    await tx`
      update app.imessage_sends
      set state = ${outcome}, sent_at = now(), provider_message_id = ${receipt?.messageId ?? null}
      where id = ${send.id}
    `;
    await tx`
      update app.imessage_links
      set status = ${outcome}, code = ${code}, valid_codes = ${tx.json(codes as Parameters<typeof tx.json>[0])}, expires_at = ${expiresAt},
          space_id = coalesce(${receipt?.spaceId ?? null}, space_id), line = coalesce(${receipt?.line ?? null}, line),
          updated_at = now(), revision = revision + 1
      where id = ${link.id}
    `;

    return { result: outcome };
  };

  handler.onExhausted = async (tx, job) => {
    if (typeof job.payload.sendId === "string") await failed(tx, job.payload.sendId, "provider_rejected");
  };

  return handler;
}

// Applies one stored webhook event. Only a text in a direct conversation from the
// number being checked counts; the reply is judged against the numbers still
// valid, and its text is cleared either way, so a linking number never stays.
export function createImessageInboundHandler(pick?: (min: number, max: number) => number): JobHandler {
  return async (tx, job) => {
    const eventId = typeof job.payload.eventId === "number" || typeof job.payload.eventId === "string" ? job.payload.eventId : null;
    const [event] = eventId
      ? await tx<{ body: string | null; content_type: string; id: string; sender: string; space_id: string; space_type: string; state: string }[]>`
          select id, sender, space_id, space_type, content_type, body, state
          from app.imessage_inbound_events where id = ${eventId} for update
        `
      : [];

    if (!event || event.state !== "received") return { result: "missing" };

    const finish = async (state: "applied" | "ignored") => {
      await tx`
        update app.imessage_inbound_events set state = ${state}, body = null, processed_at = now() where id = ${event.id}
      `;
      return { result: state };
    };

    if (event.space_type !== "dm" || event.content_type !== "text" || event.body === null) return finish("ignored");

    const [candidate] = await tx<{ id: string }[]>`
      select id from app.imessage_links
      where phone_e164 = ${event.sender} and status = any (array['pending', 'sent', 'uncertain'])
      order by created_at desc limit 1
    `;
    const link = candidate ? await lockedLink(tx, candidate.id) : null;

    if (!link) return finish("ignored");

    const now = await databaseNow(tx);
    const outcome = judgeReply(link, event.body, now, pick);

    switch (outcome.kind) {
      case "ignore":
        return finish("ignored");
      case "connect":
        // The number may have been linked to another host since the check began.
        if (await phoneHeldElsewhere(tx, link.host_account_id, link.phone_e164)) {
          await tx`
            update app.imessage_links set status = 'failed', failure = 'phone_taken', valid_codes = '[]'::jsonb,
              code = null, retry_eligible_at = null, updated_at = now(), revision = revision + 1
            where id = ${link.id}
          `;
          return finish("applied");
        }
        await tx`
          update app.imessage_links
          set status = 'connected', connected_at = now(), valid_codes = '[]'::jsonb, code = null, failure = null,
              retry_eligible_at = null, space_id = coalesce(space_id, ${event.space_id}),
              updated_at = now(), revision = revision + 1
          where id = ${link.id}
        `;
        return finish("applied");
      case "wrong":
        await tx`
          update app.imessage_links
          set wrong_replies = ${outcome.wrongReplies}, code = ${outcome.code},
              valid_codes = ${tx.json([{ code: outcome.code, expiresAt: link.expires_at.toISOString() }] as Parameters<typeof tx.json>[0])},
              updated_at = now(), revision = revision + 1
          where id = ${link.id}
        `;
        return finish("applied");
      case "lock":
        await tx`
          update app.imessage_links
          set status = 'failed', failure = 'too_many_wrong_replies', wrong_replies = ${outcome.wrongReplies},
              valid_codes = '[]'::jsonb, code = null, retry_eligible_at = ${outcome.retryEligibleAt},
              updated_at = now(), revision = revision + 1
          where id = ${link.id}
        `;
        return finish("applied");
    }
  };
}


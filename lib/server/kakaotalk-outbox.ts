import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { type ChannelLanguage, hostConversationLanguage } from "./channel-language";
import { channelReplies } from "./channel-texts";
import type { Database, Transaction } from "./database";
import { bindingContext } from "./imessage-links";
import { SAMPLE_NOTICE_PREFIX } from "./imessage-notices";
import { type OutboxKind, openedWithButtons, outboxSealContext } from "./imessage-outbox";
import {
  KAKAOTALK_CLAIM_WAIT_MS,
  KAKAOTALK_LEASE_SECONDS,
  KAKAOTALK_NUDGE_MINUTES,
  KAKAOTALK_NUDGE_TEXT,
  KAKAOTALK_REQUEUES,
  leaseTokenHash,
  type RelayKind,
} from "./kakaotalk";
import { authenticateRelay, type RelayDependencies, relayAnswer, relayDependenciesFromEnvironment } from "./kakaotalk-receiver";
import type { PhotonContent } from "./photon";
import { GROUP_REPLY_PREFIX } from "./kakaotalk-groups";
import { channelHash } from "./photon-receiver";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// The KakaoTalk relay outbox (host-kakaotalk-channel design 5 and 7, D5 and
// D7). The relay phone cannot be called, so it pulls: the imessage_send job
// freezes a KakaoTalk row's text and runs its checks as for any channel, then
// leaves it queued, and the relay claims it here.
//
// POST /kakaotalk/outbox/claim { postedRooms, replyableRooms?, locked } waits up to 25 seconds
// for one message and answers 204 when there is none. A claim hands out
// nothing while the relay is down (app.check_kakaotalk_relay). Otherwise it
// ends every lease past its 120 seconds as uncertain, then walks the chats in
// queue order, skipping a chat that holds a lease or whose next row still
// waits on its send job. The next row of a chat is checked again first: a row
// whose binding ended is suppressed (unlinked), an awaiting-approval summary
// whose proposal has a later version is suppressed (superseded), and a kind
// the relay cannot send is suppressed (unsupported). Every row is private, so
// it is handed out in reply mode only when its room is in postedRooms or in
// replyableRooms (rooms whose reply action the relay still holds). A bound
// chat with no posted notification gets the fixed nudge instead, at most once an
// hour and never while the phone is locked, and its content stays queued. The
// answer is { id, leaseToken, mode, roomId, displayName, text }; the lease
// token is kept only as its SHA-256.
//
// POST /kakaotalk/outbox/:id/result { leaseToken, outcome } is accepted once,
// with the current token, while the lease holds: accepted, failed and
// uncertain are final (and clear the sealed values); not_started puts the row
// back in the queue, at most three times, then fails it; a nudge too, and a
// requeued nudge is claimed again before any new one (and suppressed once the
// host writes, since content then follows in reply mode). A report after the lease ended makes
// the row uncertain (if it is not already) and is refused with 409, as is a
// wrong token; an uncertain row is never sent again.
//
// POST /kakaotalk/heartbeat records the relay's latest state; a heartbeat with
// both services enabled clears the down state, and one with a disabled service
// records the alert at once.
//
// The Mac relay (host-kakaotalk-mac-relay) uses the same routes. Its bodies say
// "relay": "mac", and only the relay KAKAOTALK_ACTIVE_RELAY names may claim or
// beat; the other is answered 409 standby, and a claim hands out nothing until
// the last heartbeat came from the active relay (design 1). The Mac relay lists
// the 1:1 rooms it may send to as replyableRooms and the group rooms it is in
// as memberRooms. It never gets a nudge, and nothing while its screen is locked
// (designs 6 and 8). A leave_room row is handed to it in leave mode while the
// room is in memberRooms, and is suppressed when the room is not, or while the
// phone is active (design 7). A result may carry reason wrong_room: the message
// landed in another room, which raises an alert (design 5).

export type ClaimedMessage = {
  readonly id: string;
  readonly leaseToken: string;
  readonly mode: "reply" | "nudge" | "leave";
  readonly roomId: string;
  readonly displayName: string | null;
  readonly text: string;
};

export type KakaoTalkOutboxDependencies = RelayDependencies & {
  // The canonical origin a review link on /app points to.
  readonly origin: string;
  // How long a claim waits for work, and how often it looks again.
  readonly claimWaitMs?: number;
  readonly pollMs?: number;
};

function outboxDependenciesFromEnvironment(): KakaoTalkOutboxDependencies {
  const relay = relayDependenciesFromEnvironment();
  return {
    config: relay.config,
    get db() {
      return relay.db;
    },
    origin: process.env.APP_ORIGIN?.trim() || "https://findmeatime.com",
    get tokenKey() {
      return relay.tokenKey;
    },
    get tokenKeys() {
      return relay.tokenKeys;
    },
  };
}

const ROOMS = z.array(z.string().regex(/^\d{1,40}$/)).max(3000);
const RELAY = z.enum(["android", "mac"]).default("android");
const claimBody = z
  .object({
    groupRooms: ROOMS.optional(),
    locked: z.boolean().optional(),
    memberRooms: ROOMS.optional(),
    postedRooms: ROOMS.optional(),
    relay: RELAY,
    replyableRooms: ROOMS.optional(),
  })
  .passthrough();
const resultBody = z
  .object({
    leaseToken: z.string().min(16).max(200),
    outcome: z.enum(["accepted", "failed", "uncertain", "not_started"]),
    reason: z.enum(["wrong_room"]).optional(),
  })
  .passthrough();
const heartbeatBody = z
  .object({
    accessibilityEnabled: z.boolean(),
    kakaoVersion: z.string().trim().min(1).max(40).nullable().optional(),
    listenerEnabled: z.boolean(),
    locked: z.boolean(),
    postedRooms: ROOMS.optional(),
    relay: RELAY,
    replyableRooms: ROOMS.optional(),
  })
  .passthrough();

// Kinds the relay has no way to send: a read mark, a button edit or answer, a
// contact card and a WhatsApp template.
const UNSUPPORTED: ReadonlySet<OutboxKind> = new Set(["signal", "edit_markup", "callback_answer", "contact_card", "template"]);

type OpenRow = {
  readonly id: string;
  readonly kind: OutboxKind;
  readonly state: "waiting" | "queued";
  readonly dedupe_key: string;
  readonly recipient_hash: string;
  readonly binding_id: string | null;
  readonly host_account_id: string | null;
  readonly request_id: string | null;
  readonly recipient_ciphertext: string | null;
  readonly text_ciphertext: string | null;
  readonly sealed_key_id: string | null;
  readonly job_pending: boolean;
  // Queued more than an hour ago.
  readonly stale: boolean;
};

async function suppress(tx: Transaction, id: string, category: string) {
  await tx`
    update app.imessage_outbox
    set state = 'suppressed', failure_category = ${category}, recipient_ciphertext = null, text_ciphertext = null,
        completed_at = now(), updated_at = now()
    where id = ${id} and state in ('waiting', 'queued')
  `;
}

// Leases that ended with no report: the message may have gone out (D5).
export async function expireKakaoTalkLeases(q: Database | Transaction) {
  await q`
    update app.imessage_outbox
    set state = 'uncertain', failure_category = 'lease_expired', lease_token_hash = null, lease_expires_at = null,
        recipient_ciphertext = null, text_ciphertext = null, completed_at = now(), updated_at = now()
    where channel = 'kakaotalk' and state = 'dispatching' and lease_expires_at <= now()
  `;
}

// An awaiting-approval summary of a version that a later proposal replaced.
async function superseded(tx: Transaction, row: OpenRow) {
  const match = /^notice:awaiting_approval:[0-9a-f-]{36}:v(\d+)$/.exec(row.dedupe_key);
  if (!match || !row.request_id) return false;
  const [later] = await tx`select 1 from app.proposals where request_id = ${row.request_id} and version > ${Number(match[1])} limit 1`;
  return Boolean(later);
}

// What the relay sends for a row: its text, or for a picture the relay cannot
// send, the same summary with a link to the view on /app (Q5).
async function textOf(tx: Transaction, deps: KakaoTalkOutboxDependencies, row: OpenRow, sealed: string) {
  const app = `${deps.origin.replace(/\/+$/, "")}/app`;
  const language = async (): Promise<ChannelLanguage> => (row.host_account_id ? hostConversationLanguage(tx, row.host_account_id) : "en");
  if (row.kind === "image") {
    const image = JSON.parse(sealed) as Omit<Extract<PhotonContent, { kind: "image" }>, "kind">;
    const texts = channelReplies(image.language);
    return `${image.summary ?? texts.onboarding.slotSummary(image.preview)}\n\n${texts.kakaotalkSlotReview(app)}`;
  }
  if (row.kind === "schedule_image") return channelReplies(await language()).kakaotalkSchedule(app);
  return openedWithButtons(row.kind, sealed).text;
}

// Leases the rows of one claim under one token.
async function lease(tx: Transaction, ids: readonly string[]) {
  const token = randomBytes(32).toString("base64url");
  await tx`
    update app.imessage_outbox
    set state = 'dispatching', dispatched_at = now(), lease_token_hash = ${leaseTokenHash(token)},
        lease_expires_at = now() + make_interval(secs => ${KAKAOTALK_LEASE_SECONDS}), claim_attempts = claim_attempts + 1, updated_at = now()
    where id = any(${ids}::uuid[])
  `;
  return token;
}

// One claim attempt in one transaction; null when nothing may be handed out now.
export type ClaimRooms = {
  // Rooms with a posted notification.
  readonly posted: ReadonlySet<string>;
  // Rooms whose reply action the relay still holds after KakaoTalk removed the
  // notification. A reply through a kept action works while the phone is locked.
  // From the Mac relay: the 1:1 rooms it may send to (host-kakaotalk-mac-relay
  // designs 5 and 6).
  readonly replyable: ReadonlySet<string>;
  // The relay that claims, and from the Mac relay the group rooms the account is in.
  readonly relay?: RelayKind;
  readonly member?: ReadonlySet<string>;
  // From the Mac relay: the group rooms it may send to, whose title picks them
  // and no other room (kakaotalk-group-conversations design 4).
  readonly group?: ReadonlySet<string>;
};

// The open rows that head their chat, oldest first: one per chat, skipping a
// chat that holds a lease, so a long quiet queue never hides newer chats.
const HEAD_LIMIT = 200;

async function headRows(q: Transaction | Database, recipientHash: string | null = null) {
  return q<OpenRow[]>`
    select * from (
      select distinct on (o.recipient_hash)
             o.id, o.kind, o.state, o.dedupe_key, o.recipient_hash, o.binding_id, o.host_account_id, o.request_id,
             o.recipient_ciphertext, o.text_ciphertext, o.sealed_key_id, o.created_at,
             o.created_at < now() - interval '1 hour' as stale,
             exists (
               select 1 from app.jobs j
               where j.kind = 'imessage_send' and j.dedupe_key = 'outbox:' || o.id::text and j.state in ('pending', 'running')
             ) as job_pending
      from app.imessage_outbox o
      where o.channel = 'kakaotalk' and o.kind <> 'nudge' and o.state in ('waiting', 'queued')
        and (${recipientHash}::text is null or o.recipient_hash = ${recipientHash})
        and not exists (
          select 1 from app.imessage_outbox l
          where l.channel = 'kakaotalk' and l.state = 'dispatching' and l.recipient_hash = o.recipient_hash
        )
      order by o.recipient_hash, o.created_at, o.id
    ) heads
    order by created_at, id
    limit ${HEAD_LIMIT}
  `;
}

// Whether any chat has a head row that may be handed out now; a cheap check,
// with no lock, that keeps an idle long poll from running the claim.
export async function kakaotalkWorkWaiting(db: Database) {
  const [row] = await db<{ waiting: boolean }[]>`
    select exists (
      select 1 from app.imessage_outbox o
      where o.channel = 'kakaotalk' and o.state = 'queued'
        and not exists (
          select 1 from app.jobs j
          where j.kind = 'imessage_send' and j.dedupe_key = 'outbox:' || o.id::text and j.state in ('pending', 'running')
        )
    ) or exists (
      select 1 from app.imessage_outbox where channel = 'kakaotalk' and state = 'dispatching' and lease_expires_at <= now()
    ) as waiting
  `;
  return row?.waiting === true;
}

export async function claimKakaoTalkMessage(
  deps: KakaoTalkOutboxDependencies,
  rooms: ClaimRooms,
  phoneLocked: boolean,
): Promise<ClaimedMessage | null> {
  return deps.db.begin(async (tx) => {
    // One relay claims at a time, so a chat never holds two leases.
    await tx`select pg_advisory_xact_lock(hashtextextended('app.kakaotalk_claim', 0))`;
    const [health] = await tx<{ cause: string | null; locked: boolean | null; relay_kind: string | null }[]>`
      select app.check_kakaotalk_relay() as cause,
             (select locked from app.kakaotalk_relay_heartbeats where relay = 'relay') as locked,
             (select relay_kind from app.kakaotalk_relay_heartbeats where relay = 'relay') as relay_kind
    `;
    if (health?.cause) return null;
    const relay = rooms.relay ?? "android";
    // After a switch of relays, nothing goes out before the new relay's first heartbeat.
    if (health?.relay_kind !== relay) return null;
    const locked = phoneLocked || health?.locked === true;
    await expireKakaoTalkLeases(tx);
    // A locked Mac exposes no windows, so it can send nothing (host-kakaotalk-mac-relay design 8).
    if (relay === "mac" && locked) return null;

    // A requeued nudge whose chat has nothing left to send would wait forever.
    await tx`
      update app.imessage_outbox n
      set state = 'suppressed', failure_category = 'no_content', recipient_ciphertext = null, text_ciphertext = null,
          completed_at = now(), updated_at = now()
      where n.channel = 'kakaotalk' and n.kind = 'nudge' and n.state = 'queued'
        and not exists (
          select 1 from app.imessage_outbox c
          where c.channel = 'kakaotalk' and c.kind <> 'nudge' and c.recipient_hash = n.recipient_hash and c.state in ('waiting', 'queued')
        )
    `;
    const heads = await headRows(tx);

    type Binding = { state: string; sender_name_ciphertext: string | null; sealed_key_id: string | null };
    type Checked =
      | { readonly status: "suppressed" }
      | { readonly status: "blocked" }
      | { readonly status: "ready"; readonly roomId: string; readonly sealed: string; readonly binding: Binding | undefined };
    // The claim-time checks of one row: suppressed (and the chat's next row
    // decides), blocked (the chat waits), or ready to hand out.
    const check = async (row: OpenRow): Promise<Checked> => {
      if (row.state === "waiting" || row.job_pending) return { status: "blocked" };
      // Only the Mac relay can leave a room (host-kakaotalk-mac-relay design 7).
      // A group chat's reply (marked by its dedupe key) goes only through the Mac
      // relay, and not at all once it is an hour old: a late answer out of
      // context is worse than none (kakaotalk-group-conversations design 4).
      const groupReply = row.kind === "turn" && row.dedupe_key.startsWith(GROUP_REPLY_PREFIX);
      if (UNSUPPORTED.has(row.kind) || ((row.kind === "leave_room" || groupReply) && relay !== "mac")) {
        await suppress(tx, row.id, "unsupported");
        return { status: "suppressed" };
      }
      let binding: Binding | undefined;
      if (row.binding_id) {
        [binding] = await tx<Binding[]>`
          select state, sender_name_ciphertext, sealed_key_id from app.imessage_bindings where id = ${row.binding_id}
        `;
        if (binding?.state !== "active") {
          await suppress(tx, row.id, "unlinked");
          return { status: "suppressed" };
        }
      }
      if (await superseded(tx, row)) {
        await suppress(tx, row.id, "superseded");
        return { status: "suppressed" };
      }
      // A sample request's notice goes out only while the tutorial request is open.
      if (row.kind === "notice" && row.dedupe_key.startsWith(SAMPLE_NOTICE_PREFIX)) {
        const [sample] = row.request_id
          ? await tx`select 1 from app.requests where id = ${row.request_id} and is_sample and closed_at is null and expires_at > now()`
          : [];
        if (!sample) {
          await suppress(tx, row.id, "sample_finished");
          return { status: "suppressed" };
        }
      }
      const open = (ciphertext: string | null) =>
        ciphertext && row.sealed_key_id ? openToken(deps.tokenKeys, { ciphertext, keyId: row.sealed_key_id }, outboxSealContext(row.id)) : null;
      let roomId = "";
      let sealed: string | null = null;
      try {
        roomId = (JSON.parse(open(row.recipient_ciphertext) ?? "null") as { address?: string } | null)?.address ?? "";
        sealed = open(row.text_ciphertext);
      } catch {
        roomId = "";
      }
      if (!roomId || sealed === null) {
        await tx`
          update app.imessage_outbox
          set state = 'failed', failure_category = 'unreadable', recipient_ciphertext = null, text_ciphertext = null,
              completed_at = now(), updated_at = now()
          where id = ${row.id}
        `;
        return { status: "suppressed" };
      }
      return { binding, roomId, sealed, status: "ready" };
    };

    for (const head of heads) {
      // A suppressed row lets the chat's next row decide; a blocked one holds the chat.
      let row: OpenRow | undefined = head;
      let checked = await check(row);
      while (checked.status === "suppressed") {
        [row] = await headRows(tx, head.recipient_hash);
        if (!row) break;
        checked = await check(row);
      }
      if (!row || checked.status !== "ready") continue;
      const { binding, roomId, sealed } = checked;

      if (row.kind === "leave_room") {
        // The account already left a room the Mac relay no longer lists.
        if (!rooms.member?.has(roomId)) {
          await suppress(tx, row.id, "not_member");
          continue;
        }
        return { displayName: null, id: row.id, leaseToken: await lease(tx, [row.id]), mode: "leave" as const, roomId, text: "" };
      }

      let name: string | null = null;
      if (binding?.sender_name_ciphertext && binding.sealed_key_id) {
        try {
          name = openToken(deps.tokenKeys, { ciphertext: binding.sender_name_ciphertext, keyId: binding.sealed_key_id }, bindingContext(row.binding_id!));
        } catch {
          name = null;
        }
      }

      const groupReply = row.kind === "turn" && row.dedupe_key.startsWith(GROUP_REPLY_PREFIX);
      if (groupReply && row.stale) {
        await suppress(tx, row.id, "stale");
        continue;
      }
      if (groupReply ? rooms.group?.has(roomId) : rooms.posted.has(roomId) || rooms.replyable.has(roomId)) {
        // The host wrote again, so a nudge still waiting for this chat has no point.
        await tx`
          update app.imessage_outbox
          set state = 'suppressed', failure_category = 'reply_posted', recipient_ciphertext = null, text_ciphertext = null,
              completed_at = now(), updated_at = now()
          where channel = 'kakaotalk' and kind = 'nudge' and recipient_hash = ${row.recipient_hash} and state = 'queued'
        `;
        const ids = [row.id];
        const text = await textOf(tx, deps, row, sealed);
        return { displayName: name, id: row.id, leaseToken: await lease(tx, ids), mode: "reply" as const, roomId, text };
      }

      // No notification of this chat is posted: at most the fixed nudge, which
      // needs a bound chat's name, an unlocked phone and no nudge this hour; a
      // locked phone still sends replies through posted or kept actions. The
      // Mac relay never nudges: a room it does not list waits (host-kakaotalk-mac-relay design 6).
      if (relay === "mac" || !row.binding_id || !name || locked) continue;
      // A nudge the relay could not start is claimed again, as content is (design 5).
      const [requeued] = await tx<{ id: string }[]>`
        select id from app.imessage_outbox
        where channel = 'kakaotalk' and kind = 'nudge' and recipient_hash = ${row.recipient_hash} and state = 'queued'
        order by created_at, id limit 1
      `;
      if (requeued) {
        return { displayName: name, id: requeued.id, leaseToken: await lease(tx, [requeued.id]), mode: "nudge" as const, roomId, text: KAKAOTALK_NUDGE_TEXT };
      }
      const [recent] = await tx`
        select 1 from app.imessage_outbox
        where channel = 'kakaotalk' and kind = 'nudge' and recipient_hash = ${row.recipient_hash}
          and created_at > now() - make_interval(mins => ${KAKAOTALK_NUDGE_MINUTES})
          and coalesce(failure_category, '') <> 'not_started'
        limit 1
      `;
      if (recent) continue;

      const [created] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      const key = deps.tokenKeys.find((candidate) => candidate.id === row.sealed_key_id) ?? deps.tokenKey;
      const context = outboxSealContext(created!.id);
      await tx`
        insert into app.imessage_outbox
          (id, channel, kind, dedupe_key, host_account_id, binding_id, recipient_hash, recipient_ciphertext, text_ciphertext, sealed_key_id)
        values (${created!.id}, 'kakaotalk', 'nudge', ${`nudge:${row.id}:${created!.id}`}, ${row.host_account_id}, ${row.binding_id},
                ${row.recipient_hash}, ${sealToken(key, JSON.stringify({ address: roomId, spaceId: roomId }), context).ciphertext},
                ${sealToken(key, KAKAOTALK_NUDGE_TEXT, context).ciphertext}, ${key.id})
      `;
      return { displayName: name, id: created!.id, leaseToken: await lease(tx, [created!.id]), mode: "nudge" as const, roomId, text: KAKAOTALK_NUDGE_TEXT };
    }
    return null;
  });
}

export type ReportOutcome = "accepted" | "failed" | "uncertain" | "not_started";

// The relay's report on one claimed message; refused (with the row's state)
// unless it carries the current token while the lease holds. An uncertain
// report with reason wrong_room means the message landed in another room
// (host-kakaotalk-mac-relay design 5): it is recorded as relay_wrong_room, which
// the operator snapshot lists, and logged as an error.
export async function reportKakaoTalkResult(db: Database, id: string, token: string, outcome: ReportOutcome, reason?: "wrong_room") {
  return db.begin(async (tx) => {
    const [row] = await tx<{ state: string; kind: OutboxKind; lease_token_hash: string | null; live: boolean; claim_attempts: number }[]>`
      select state, kind, lease_token_hash, lease_expires_at > now() as live, claim_attempts
      from app.imessage_outbox where id = ${id} and channel = 'kakaotalk'
      for update
    `;
    if (!row) return { accepted: false as const, state: "missing" };
    if (row.state !== "dispatching" || !row.lease_token_hash) return { accepted: false as const, state: row.state };
    if (!row.live) {
      await expireKakaoTalkLeases(tx);
      return { accepted: false as const, state: "uncertain" };
    }
    if (!timingSafeEqual(Buffer.from(leaseTokenHash(token), "hex"), Buffer.from(row.lease_token_hash, "hex"))) {
      return { accepted: false as const, state: row.state };
    }

    // The report covers every row the claim leased under this token.
    const batch = (
      await tx<{ id: string }[]>`
        select id from app.imessage_outbox
        where channel = 'kakaotalk' and state = 'dispatching' and lease_token_hash = ${row.lease_token_hash}
        for update
      `
    ).map((leased) => leased.id);
    if (outcome === "not_started" && row.claim_attempts <= KAKAOTALK_REQUEUES) {
      await tx`
        update app.imessage_outbox
        set state = 'queued', failure_category = 'not_started', lease_token_hash = null, lease_expires_at = null, updated_at = now()
        where id = any(${batch}::uuid[])
      `;
      return { accepted: true as const, state: "queued" };
    }
    const state = outcome === "accepted" ? "accepted" : outcome === "uncertain" ? "uncertain" : "failed";
    const category =
      outcome === "accepted"
        ? null
        : outcome === "uncertain"
          ? reason === "wrong_room"
            ? "relay_wrong_room"
            : "relay_uncertain"
          : outcome === "not_started"
            ? "not_started"
            : "relay_failed";
    if (category === "relay_wrong_room") console.error("kakaotalk relay sent to the wrong room", { id });
    await tx`
      update app.imessage_outbox
      set state = ${state}, failure_category = ${category}, lease_token_hash = null, lease_expires_at = null,
          recipient_ciphertext = null, text_ciphertext = null, completed_at = now(), updated_at = now()
      where id = any(${batch}::uuid[])
    `;
    return { accepted: true as const, state };
  });
}

export type RelayHeartbeat = z.infer<typeof heartbeatBody>;

// Records the relay's latest heartbeat and answers whether the relay is up.
export async function recordKakaoTalkHeartbeat(db: Database, beat: RelayHeartbeat) {
  return db.begin(async (tx) => {
    const healthy = beat.listenerEnabled && beat.accessibilityEnabled;
    await tx`
      insert into app.kakaotalk_relay_heartbeats as h
        (relay, received_at, listener_enabled, accessibility_enabled, locked, kakaotalk_version, posted_rooms, relay_kind)
      values ('relay', now(), ${beat.listenerEnabled}, ${beat.accessibilityEnabled}, ${beat.locked}, ${beat.kakaoVersion ?? null},
              ${(beat.relay === "mac" ? beat.replyableRooms : beat.postedRooms)?.length ?? 0}, ${beat.relay})
      on conflict (relay) do update
      set received_at = excluded.received_at, relay_kind = excluded.relay_kind, listener_enabled = excluded.listener_enabled,
          accessibility_enabled = excluded.accessibility_enabled, locked = excluded.locked,
          kakaotalk_version = excluded.kakaotalk_version, posted_rooms = excluded.posted_rooms,
          down_since = case when ${healthy} then null else h.down_since end,
          down_cause = case when ${healthy} then null else h.down_cause end,
          down_alerted_at = case when ${healthy} then null else h.down_alerted_at end
    `;
    await expireKakaoTalkLeases(tx);
    const [health] = await tx<{ cause: string | null }[]>`select app.check_kakaotalk_relay() as cause`;
    return { cause: health?.cause ?? null };
  });
}

function parse<T>(schema: z.ZodType<T>, body: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function receiveKakaoTalkClaim(request: Request, load: () => KakaoTalkOutboxDependencies = outboxDependenciesFromEnvironment) {
  const deps = load();
  const verified = await authenticateRelay(request, "outbox", deps);
  if ("refusal" in verified) return verified.refusal;
  const body = parse(claimBody, verified.body);
  if (!body) return relayAnswer(400);
  if (body.relay !== deps.config.activeRelay) return relayAnswer(409, { status: "standby" });

  // A reply may go to a room with a posted notification or one whose reply action the relay still holds.
  const rooms = {
    group: new Set(body.groupRooms ?? []),
    member: new Set(body.memberRooms ?? []),
    posted: new Set(body.postedRooms ?? []),
    relay: body.relay,
    replyable: new Set(body.replyableRooms ?? []),
  };
  const deadline = Date.now() + (deps.claimWaitMs ?? KAKAOTALK_CLAIM_WAIT_MS);
  for (;;) {
    // An idle poll only looks for work; the claim's lock and checks run when there is some.
    const claimed = (await kakaotalkWorkWaiting(deps.db)) ? await claimKakaoTalkMessage(deps, rooms, body.locked === true) : null;
    if (claimed) return relayAnswer(200, claimed);
    if (Date.now() + (deps.pollMs ?? 1_000) > deadline) return relayAnswer(204);
    await sleep(deps.pollMs ?? 1_000);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function receiveKakaoTalkResult(request: Request, id: string, load: () => RelayDependencies = relayDependenciesFromEnvironment) {
  const deps = load();
  const verified = await authenticateRelay(request, "outbox", deps);
  if ("refusal" in verified) return verified.refusal;
  if (!UUID.test(id)) return relayAnswer(404);
  const body = parse(resultBody, verified.body);
  if (!body) return relayAnswer(400);

  const result = await reportKakaoTalkResult(deps.db, id.toLowerCase(), body.leaseToken, body.outcome, body.reason);
  if (result.state === "missing") return relayAnswer(404);
  return relayAnswer(result.accepted ? 200 : 409, { state: result.state });
}

export async function receiveKakaoTalkHeartbeat(request: Request, load: () => RelayDependencies = relayDependenciesFromEnvironment) {
  const deps = load();
  const verified = await authenticateRelay(request, "outbox", deps);
  if ("refusal" in verified) return verified.refusal;
  const body = parse(heartbeatBody, verified.body);
  if (!body) return relayAnswer(400);
  if (body.relay !== deps.config.activeRelay) return relayAnswer(409, { status: "standby" });

  const { cause } = await recordKakaoTalkHeartbeat(deps.db, body);
  if (cause) console.warn("kakaotalk relay down", { cause });
  return relayAnswer(200, cause ? { cause, status: "down" } : { status: "up" });
}

// A leave row's sealed text: a marker, never sent (a sealed empty string does not open).
const LEAVE_MARKER = "leave_room";

// Queues a request for the Mac relay to leave a group room
// (host-kakaotalk-mac-relay design 7). It carries no message text; the group change
// creates it for /kickout. The row is queued at once, with no send job, and the
// claim decides whether it goes out. A repeated dedupe key records nothing new.
export async function queueKakaoTalkLeave(db: Database | Transaction, tokenKey: TokenKey, roomId: string, dedupeKey: string) {
  if (!/^\d{1,40}$/.test(roomId)) throw new Error("A KakaoTalk room ID is a decimal number.");
  const [created] = await db<{ id: string }[]>`select gen_random_uuid() as id`;
  const id = created!.id;
  const context = outboxSealContext(id);
  const [row] = await db<{ id: string }[]>`
    insert into app.imessage_outbox (id, channel, kind, dedupe_key, recipient_hash, recipient_ciphertext, text_ciphertext, sealed_key_id)
    values (${id}, 'kakaotalk', 'leave_room', ${dedupeKey}, ${channelHash(tokenKey, "kakaotalk", "space", roomId)},
            ${sealToken(tokenKey, JSON.stringify({ address: roomId, spaceId: roomId }), context).ciphertext},
            ${sealToken(tokenKey, LEAVE_MARKER, context).ciphertext}, ${tokenKey.id})
    on conflict (kind, dedupe_key) do nothing
    returning id
  `;
  return row?.id ?? null;
}

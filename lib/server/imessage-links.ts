import { createHmac, randomInt } from "node:crypto";
import { z } from "zod";
import {
  type ImessageDeliveryState,
  type ImessageStatus,
  linkMessage,
  maskSender,
  normalizeNumber,
} from "../contracts/imessage";
import { lockActiveHost } from "./analysis";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { generateLinkCode, hashLinkCode } from "./email-links";
import { recordOutbound } from "./imessage-outbox";
import { imessageHash } from "./photon-receiver";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// Linking a host's iMessage (host-imessage-channel design 4, 6 and 11; D3, D5,
// D6, D13). The card's commands run as the signed-in host through the command
// pipeline:
//   - imessage.link.create makes a one-time FMAT- code (hashed, and sealed so a
//     reload shows it again), valid 15 minutes, at most 5 an hour; the card opens
//     Messages with linkMessage(code) and the line's number;
//   - receiveLinkCode is the receipt job's side: a pending code arriving from a
//     direct conversation records the sender for confirmation and replies in
//     that conversation; any other arrival voids the attempt;
//   - imessage.link.confirm binds the recorded sender after the host saw it
//     masked; nothing is bound before;
//   - imessage.link.send_code and imessage.link.verify_code are the fallback: a
//     six-digit code the line sends to an entered number, typed back here;
//   - imessage.unlink ends the binding in the database only, so it works while
//     Photon is unreachable; imessage.contact_card.share queues one contact card.
// A host has one open attempt and one active binding; a sender belongs to one
// host. Lock order: the account share lock, then the host's advisory link lock,
// then the line's fallback lock.

export const IMESSAGE_LINK_LIMITS = {
  // Link codes a host may create per hour.
  perHostHour: 5,
  validMinutes: 15,
  // How long the host has to confirm after the code's message arrived.
  confirmMinutes: 15,
} as const;

export const IMESSAGE_FALLBACK_LIMITS = {
  validMinutes: 10,
  sendsPerAttempt: 3,
  spacingSeconds: 60,
  perHostDay: 5,
  wrongEntries: 5,
  // Fallback sends per line per rolling 24 hours; PHOTON_FALLBACK_DAILY_LIMIT overrides it.
  perLineDay: 20,
} as const;

export type LinkOptions = {
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  // The line's number; linking is unavailable without one.
  readonly lineNumber: string;
  readonly fallbackLimits?: Partial<typeof IMESSAGE_FALLBACK_LIMITS>;
  readonly linkLimits?: Partial<typeof IMESSAGE_LINK_LIMITS>;
};

export function fallbackDailyLimit(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = Number(env.PHOTON_FALLBACK_DAILY_LIMIT);
  return Number.isInteger(value) && value >= 0 ? value : IMESSAGE_FALLBACK_LIMITS.perLineDay;
}

export const LINK_TEXTS = {
  received: "Got it. Go back to Find Me a Time in your browser and tap Confirm and link to finish.",
  refused: "That link code is not valid any more. Start again from Connect iMessage in Find Me a Time.",
  linked: "Linked. Send help for what I can do here.",
  fallbackCode: (code: string, minutes: number) => `Your Find Me a Time code is ${code}. It expires in ${minutes} minutes.`,
} as const;

function codeContext(linkId: string) {
  return `imessage_link_code:${linkId}`;
}

function senderContext(linkId: string) {
  return `imessage_link_sender:${linkId}`;
}

export function bindingContext(bindingId: string) {
  return `imessage_binding:${bindingId}`;
}

export function fallbackCodeHash(key: TokenKey, linkId: string, code: string) {
  const derived = createHmac("sha256", key.key).update("find-me-a-time/imessage-fallback-code/v1").digest();
  return createHmac("sha256", derived).update(`${linkId}:${code}`, "utf8").digest("hex");
}

function assertSelf(context: { actor: { kind: string; id: string }; resourceId: string }) {
  if (context.actor.kind !== "host_account" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
  return context.actor.id;
}

async function lockHostLinking(tx: Transaction, hostAccountId: string) {
  await lockActiveHost(tx, hostAccountId);
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_link:${hostAccountId}`}, 0))`;
}

// Open attempts end with every sealed value cleared.
async function endOpenAttempts(tx: Transaction, hostAccountId: string, state: "voided" | "cancelled") {
  await tx`
    update app.imessage_links
    set state = ${state}, ended_at = now(), code_ciphertext = null, phone_ciphertext = null, sender_ciphertext = null,
        space_ciphertext = null, fallback_code_hash = null
    where host_account_id = ${hostAccountId} and state in ('pending', 'received')
  `;
}

type ActiveBinding = {
  readonly id: string;
  readonly host_account_id: string;
  readonly sender_hash: string;
  readonly sender_ciphertext: string;
  readonly space_ciphertext: string | null;
  readonly sealed_key_id: string;
  readonly selected_request_id: string | null;
  readonly linked_at: Date;
};

export async function activeBindingOfHost(q: Queryable, hostAccountId: string) {
  const [row] = await q<ActiveBinding[]>`
    select id, host_account_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id, selected_request_id, linked_at
    from app.imessage_bindings where host_account_id = ${hostAccountId} and state = 'active'
  `;
  return row ?? null;
}

export async function activeBindingOfSender(q: Queryable, senderHash: string) {
  const [row] = await q<ActiveBinding[]>`
    select id, host_account_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id, selected_request_id, linked_at
    from app.imessage_bindings where sender_hash = ${senderHash} and state = 'active'
  `;
  return row ?? null;
}

// The binding's sender and conversation, for a reply.
export function bindingRecipient(keys: readonly TokenKey[], binding: Pick<ActiveBinding, "id" | "sender_ciphertext" | "space_ciphertext" | "sealed_key_id">) {
  const open = (ciphertext: string) => openToken(keys, { ciphertext, keyId: binding.sealed_key_id }, bindingContext(binding.id));
  return { address: open(binding.sender_ciphertext), spaceId: binding.space_ciphertext ? open(binding.space_ciphertext) : null };
}

// Binds a sender to the host, ending the host's earlier binding, and queues the
// linked message. The caller holds the host's link lock.
async function bind(
  tx: Transaction,
  options: LinkOptions,
  hostAccountId: string,
  linkId: string,
  sender: string,
  spaceId: string | null,
) {
  const senderHash = imessageHash(options.tokenKey, "sender", sender);
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_sender:${senderHash}`}, 0))`;
  const owner = await activeBindingOfSender(tx, senderHash);
  if (owner && owner.host_account_id !== hostAccountId) throw new CommandError("invalid_input");

  await tx`
    update app.imessage_bindings set state = 'unlinked', ended_at = now(), sender_ciphertext = null, space_ciphertext = null
    where host_account_id = ${hostAccountId} and state = 'active'
  `;
  const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
  const bindingId = row!.id;
  const context = bindingContext(bindingId);
  const sealedSender = sealToken(options.tokenKey, sender, context);
  const sealedSpace = spaceId === null ? null : sealToken(options.tokenKey, spaceId, context);
  await tx`
    insert into app.imessage_bindings (id, host_account_id, link_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id)
    values (${bindingId}, ${hostAccountId}, ${linkId}, ${senderHash}, ${sealedSender.ciphertext}, ${sealedSpace?.ciphertext ?? null},
            ${options.tokenKey.id})
  `;
  await tx`
    update app.imessage_links
    set state = 'linked', binding_id = ${bindingId}, ended_at = now(), code_ciphertext = null, phone_ciphertext = null,
        sender_ciphertext = null, space_ciphertext = null, fallback_code_hash = null
    where id = ${linkId}
  `;
  await recordOutbound(tx, {
    bindingId,
    dedupeKey: `binding:${bindingId}`,
    hostAccountId,
    kind: "linked",
    linkId,
    recipient: { address: sender, spaceId },
    recipientHash: senderHash,
    text: LINK_TEXTS.linked,
    tokenKey: options.tokenKey,
  });
  return bindingId;
}

const noInput = z.object({}).strict() as unknown as z.ZodType<Record<string, never>>;

export function createImessageLinkCommand(options: LinkOptions): CommandDefinition<Record<string, never>, { linkId: string }> {
  const limits = { ...IMESSAGE_LINK_LIMITS, ...options.linkLimits };

  return {
    input: noInput,
    operation: "imessage.link.create",
    async run(tx, context) {
      const hostAccountId = assertSelf(context);
      if (!options.lineNumber) throw new CommandError("unavailable_configuration");
      await lockHostLinking(tx, hostAccountId);

      const [recent] = await tx<{ count: number }[]>`
        select count(*)::int as count from app.imessage_links
        where host_account_id = ${hostAccountId} and method = 'code' and created_at > now() - interval '1 hour'
      `;
      if (recent!.count >= limits.perHostHour) throw new CommandError("rate_limited");

      await endOpenAttempts(tx, hostAccountId, "voided");

      const code = generateLinkCode();
      const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      const sealed = sealToken(options.tokenKey, code, codeContext(row!.id));
      await tx`
        insert into app.imessage_links (id, host_account_id, method, code_hash, code_ciphertext, sealed_key_id, expires_at)
        values (${row!.id}, ${hostAccountId}, 'code', ${hashLinkCode(code)}, ${sealed.ciphertext}, ${sealed.keyId},
                now() + make_interval(mins => ${limits.validMinutes}))
      `;
      return { linkId: row!.id };
    },
  };
}

export function confirmImessageLinkCommand(options: LinkOptions): CommandDefinition<{ linkId: string }, { bindingId: string }> {
  return {
    input: z.object({ linkId: z.uuid() }).strict(),
    operation: "imessage.link.confirm",
    async run(tx, context) {
      const hostAccountId = assertSelf(context);
      await lockHostLinking(tx, hostAccountId);

      const [link] = await tx<
        { id: string; state: string; open: boolean; sender_ciphertext: string | null; space_ciphertext: string | null; sender_key_id: string | null }[]
      >`
        select id, state, confirm_by > now() as open, sender_ciphertext, space_ciphertext, sender_key_id
        from app.imessage_links where id = ${context.input.linkId} and host_account_id = ${hostAccountId}
        for update
      `;
      if (!link || link.state !== "received" || !link.open || !link.sender_ciphertext || !link.sender_key_id) {
        throw new CommandError("stale_revision");
      }

      const sealed = (ciphertext: string) => openToken(options.tokenKeys, { ciphertext, keyId: link.sender_key_id! }, senderContext(link.id));
      const sender = sealed(link.sender_ciphertext);
      const spaceId = link.space_ciphertext ? sealed(link.space_ciphertext) : null;

      return { bindingId: await bind(tx, options, hostAccountId, link.id, sender, spaceId) };
    },
  };
}

export const cancelImessageLinkCommand: CommandDefinition<Record<string, never>, { cancelled: true }> = {
  input: noInput,
  operation: "imessage.link.cancel",
  async run(tx, context) {
    const hostAccountId = assertSelf(context);
    await lockHostLinking(tx, hostAccountId);
    await endOpenAttempts(tx, hostAccountId, "cancelled");
    return { cancelled: true };
  },
};

export function sendImessageCodeCommand(
  options: LinkOptions & { readonly lineDayLimit?: number },
): CommandDefinition<{ number?: string; resend?: true }, { linkId: string }> {
  const limits = { ...IMESSAGE_FALLBACK_LIMITS, ...options.fallbackLimits };
  const lineDay = options.lineDayLimit ?? limits.perLineDay;

  return {
    // A number to send to, or a resend to the open attempt's number, which the
    // card only knows masked.
    input: z.union([
      z.object({ number: z.string().trim().min(1).max(40) }).strict(),
      z.object({ resend: z.literal(true) }).strict(),
    ]),
    operation: "imessage.link.send_code",
    async run(tx, context) {
      const hostAccountId = assertSelf(context);
      if (!options.lineNumber) throw new CommandError("unavailable_configuration");

      await lockHostLinking(tx, hostAccountId);
      await tx`select pg_advisory_xact_lock(hashtextextended('app.imessage_fallback_line', 0))`;

      const [open] = await tx<
        { id: string; method: string; phone_hash: string | null; phone_ciphertext: string | null; sealed_key_id: string | null; sends: number; spaced: boolean }[]
      >`
        select id, method, phone_hash, phone_ciphertext, sealed_key_id, sends,
               coalesce(last_sent_at <= now() - make_interval(secs => ${limits.spacingSeconds}), true) as spaced
        from app.imessage_links where host_account_id = ${hostAccountId} and state = 'pending' and expires_at > now()
        for update
      `;

      let number: string | null;
      if (context.input.resend) {
        if (open?.method !== "fallback" || !open.phone_ciphertext || !open.sealed_key_id) throw new CommandError("stale_revision");
        number = openToken(options.tokenKeys, { ciphertext: open.phone_ciphertext, keyId: open.sealed_key_id }, codeContext(open.id));
      } else {
        number = normalizeNumber(context.input.number ?? "");
      }
      if (!number) throw new CommandError("invalid_input");

      const phoneHash = imessageHash(options.tokenKey, "phone", number);
      const resend = open?.method === "fallback" && open.phone_hash === phoneHash;
      if (resend && (open.sends >= limits.sendsPerAttempt || !open.spaced)) throw new CommandError("rate_limited");

      const [counts] = await tx<{ host: number; line: number }[]>`
        select count(*) filter (where host_account_id = ${hostAccountId})::int as host, count(*)::int as line
        from app.imessage_outbox where kind = 'fallback_code' and created_at > now() - interval '24 hours'
      `;
      if (counts!.host >= limits.perHostDay || counts!.line >= lineDay) throw new CommandError("rate_limited");

      let linkId: string;

      if (resend) {
        linkId = open.id;
      } else {
        await endOpenAttempts(tx, hostAccountId, "voided");
        const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
        linkId = row!.id;
        const sealed = sealToken(options.tokenKey, number, codeContext(linkId));
        await tx`
          insert into app.imessage_links (id, host_account_id, method, phone_hash, phone_ciphertext, sealed_key_id, expires_at)
          values (${linkId}, ${hostAccountId}, 'fallback', ${phoneHash}, ${sealed.ciphertext}, ${sealed.keyId},
                  now() + make_interval(mins => ${limits.validMinutes}))
        `;
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const [sent] = await tx<{ sends: number }[]>`
        update app.imessage_links
        set fallback_code_hash = ${fallbackCodeHash(options.tokenKey, linkId, code)}, sends = sends + 1, last_sent_at = now(),
            wrong_entries = 0, fallback_expires_at = now() + make_interval(mins => ${limits.validMinutes}),
            expires_at = now() + make_interval(mins => ${limits.validMinutes})
        where id = ${linkId}
        returning sends
      `;

      // A number another host has linked gets nothing, and the card cannot tell.
      const senderHash = imessageHash(options.tokenKey, "sender", number);
      const owner = await activeBindingOfSender(tx, senderHash);
      if (owner && owner.host_account_id !== hostAccountId) return { linkId };

      await recordOutbound(tx, {
        dedupeKey: `link:${linkId}:send:${sent!.sends}`,
        hostAccountId,
        kind: "fallback_code",
        linkId,
        recipient: { address: number, spaceId: null },
        recipientHash: senderHash,
        text: LINK_TEXTS.fallbackCode(code, limits.validMinutes),
        tokenKey: options.tokenKey,
      });
      return { linkId };
    },
  };
}

export type VerifyResult = { readonly status: "linked"; readonly bindingId: string } | { readonly status: "wrong"; readonly attemptsLeft: number };

export function verifyImessageCodeCommand(options: LinkOptions): CommandDefinition<{ code: string }, VerifyResult> {
  const limits = { ...IMESSAGE_FALLBACK_LIMITS, ...options.fallbackLimits };

  return {
    input: z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict(),
    operation: "imessage.link.verify_code",
    async run(tx, context) {
      const hostAccountId = assertSelf(context);
      await lockHostLinking(tx, hostAccountId);

      const [link] = await tx<
        { id: string; fallback_code_hash: string | null; live: boolean; wrong_entries: number; phone_ciphertext: string | null; sealed_key_id: string | null }[]
      >`
        select id, fallback_code_hash, coalesce(fallback_expires_at > now(), false) as live, wrong_entries, phone_ciphertext, sealed_key_id
        from app.imessage_links where host_account_id = ${hostAccountId} and method = 'fallback' and state = 'pending'
        for update
      `;
      if (!link?.fallback_code_hash || !link.live || !link.phone_ciphertext || !link.sealed_key_id) throw new CommandError("stale_revision");

      if (fallbackCodeHash(options.tokenKey, link.id, context.input.code) !== link.fallback_code_hash) {
        // A wrong entry is counted, not thrown, so the count survives; the fifth voids the code.
        const left = limits.wrongEntries - (link.wrong_entries + 1);
        await tx`
          update app.imessage_links
          set wrong_entries = wrong_entries + 1, fallback_code_hash = case when ${left} <= 0 then null else fallback_code_hash end
          where id = ${link.id}
        `;
        return { attemptsLeft: Math.max(left, 0), status: "wrong" };
      }

      const number = openToken(options.tokenKeys, { ciphertext: link.phone_ciphertext, keyId: link.sealed_key_id }, codeContext(link.id));
      return { bindingId: await bind(tx, options, hostAccountId, link.id, number, null), status: "linked" };
    },
  };
}

export const unlinkImessageCommand: CommandDefinition<Record<string, never>, { unlinked: boolean }> = {
  input: noInput,
  operation: "imessage.unlink",
  async run(tx, context) {
    const hostAccountId = assertSelf(context);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_link:${hostAccountId}`}, 0))`;
    const ended = await tx<{ id: string }[]>`
      update app.imessage_bindings set state = 'unlinked', ended_at = now(), sender_ciphertext = null, space_ciphertext = null
      where host_account_id = ${hostAccountId} and state = 'active'
      returning id
    `;
    await endOpenAttempts(tx, hostAccountId, "cancelled");
    // Undispatched host-private messages go no further.
    if (ended.length > 0) {
      await tx`
        update app.imessage_outbox
        set state = 'suppressed', failure_category = 'unlinked', recipient_ciphertext = null, text_ciphertext = null,
            completed_at = now(), updated_at = now()
        where binding_id = ${ended[0]!.id} and state in ('waiting', 'queued')
      `;
    }
    return { unlinked: ended.length > 0 };
  },
};

export function shareContactCardCommand(options: LinkOptions): CommandDefinition<Record<string, never>, { outboxId: string }> {
  return {
    input: noInput,
    operation: "imessage.contact_card.share",
    async run(tx, context) {
      const hostAccountId = assertSelf(context);
      await lockHostLinking(tx, hostAccountId);
      const binding = await activeBindingOfHost(tx, hostAccountId);
      if (!binding) throw new CommandError("invalid_input");

      const cards = await tx<{ state: string }[]>`
        select state from app.imessage_outbox where binding_id = ${binding.id} and kind = 'contact_card' order by created_at desc
      `;
      // No resend while one is on its way or may have arrived.
      if (cards[0] && ["queued", "dispatching", "uncertain"].includes(cards[0].state)) throw new CommandError("rate_limited");

      const { id } = await recordOutbound(tx, {
        bindingId: binding.id,
        dedupeKey: `binding:${binding.id}:card:${cards.length + 1}`,
        hostAccountId,
        kind: "contact_card",
        recipient: bindingRecipient(options.tokenKeys, binding),
        recipientHash: binding.sender_hash,
        tokenKey: options.tokenKey,
      });
      return { outboxId: id };
    },
  };
}

export function imessageCommands(options: LinkOptions & { readonly lineDayLimit?: number }) {
  return {
    "imessage.contact_card.share": shareContactCardCommand(options),
    "imessage.link.cancel": cancelImessageLinkCommand,
    "imessage.link.confirm": confirmImessageLinkCommand(options),
    "imessage.link.create": createImessageLinkCommand(options),
    "imessage.link.send_code": sendImessageCodeCommand(options),
    "imessage.link.verify_code": verifyImessageCodeCommand(options),
    "imessage.unlink": unlinkImessageCommand,
  } as unknown as Readonly<Record<string, CommandDefinition<unknown, unknown>>>;
}

// ---------------------------------------------------------------------------
// The card's status

function deliveryState(state: string): ImessageDeliveryState {
  if (state === "accepted") return "sent";
  if (state === "failed" || state === "suppressed") return "failed";
  if (state === "uncertain") return "uncertain";
  return "queued";
}

export async function readImessageStatus(
  db: Queryable,
  keys: readonly TokenKey[],
  hostAccountId: string,
  lineNumber: string,
  limits: typeof IMESSAGE_FALLBACK_LIMITS = IMESSAGE_FALLBACK_LIMITS,
): Promise<ImessageStatus> {
  if (!lineNumber) return { state: "unavailable" };

  // An open attempt shows first, also while a sender is linked: finishing it
  // moves the link to the new sender.
  const open = await openAttemptStatus(db, keys, hostAccountId, lineNumber, limits);
  if (open) return open;

  const binding = await activeBindingOfHost(db, hostAccountId);

  if (binding) {
    let sender = "••••";
    try {
      sender = maskSender(bindingRecipient(keys, binding).address);
    } catch {
      // Sealed under a key the service no longer holds: still linked.
    }
    const [latest] = await db<{ state: string; updated_at: Date }[]>`
      select state, updated_at from app.imessage_outbox
      where binding_id = ${binding.id} and kind <> 'contact_card' and state in ('accepted', 'failed', 'uncertain')
      order by updated_at desc limit 1
    `;
    const [card] = await db<{ state: string }[]>`
      select state from app.imessage_outbox where binding_id = ${binding.id} and kind = 'contact_card' order by created_at desc limit 1
    `;
    return {
      contactCard: card ? { state: deliveryState(card.state) } : null,
      delivery: latest && latest.state !== "accepted" ? { at: latest.updated_at.toISOString(), state: latest.state as "failed" | "uncertain" } : null,
      lineNumber,
      linkedAt: binding.linked_at.toISOString(),
      sender,
      state: "linked",
    };
  }

  return { lineNumber, state: "none" };
}

async function openAttemptStatus(
  db: Queryable,
  keys: readonly TokenKey[],
  hostAccountId: string,
  lineNumber: string,
  limits: typeof IMESSAGE_FALLBACK_LIMITS,
): Promise<ImessageStatus | null> {
  const [link] = await db<
    {
      id: string;
      method: "code" | "fallback";
      state: "pending" | "received";
      code_ciphertext: string | null;
      phone_ciphertext: string | null;
      sealed_key_id: string | null;
      sender_ciphertext: string | null;
      sender_key_id: string | null;
      expires_at: Date;
      confirm_by: Date | null;
      fallback_expires_at: Date | null;
      last_sent_at: Date | null;
      sends: number;
    }[]
  >`
    select id, method, state, code_ciphertext, phone_ciphertext, sealed_key_id, sender_ciphertext, sender_key_id, expires_at,
           confirm_by, fallback_expires_at, last_sent_at, sends
    from app.imessage_links
    where host_account_id = ${hostAccountId}
      and ((state = 'pending' and expires_at > now()) or (state = 'received' and confirm_by > now()))
  `;

  if (!link) return null;

  try {
    if (link.state === "received") {
      const sender = openToken(keys, { ciphertext: link.sender_ciphertext!, keyId: link.sender_key_id! }, senderContext(link.id));
      return { confirmBy: link.confirm_by!.toISOString(), lineNumber, linkId: link.id, sender: maskSender(sender), state: "received" };
    }

    if (link.method === "code") {
      const code = openToken(keys, { ciphertext: link.code_ciphertext!, keyId: link.sealed_key_id! }, codeContext(link.id));
      return { code, expiresAt: link.expires_at.toISOString(), lineNumber, message: linkMessage(code), state: "pending" };
    }

    const number = openToken(keys, { ciphertext: link.phone_ciphertext!, keyId: link.sealed_key_id! }, codeContext(link.id));
    const [send] = await db<{ state: string }[]>`
      select state from app.imessage_outbox where link_id = ${link.id} and kind = 'fallback_code' order by created_at desc limit 1
    `;
    const sendsLeft = Math.max(limits.sendsPerAttempt - link.sends, 0);
    return {
      expiresAt: link.fallback_expires_at?.toISOString() ?? null,
      lineNumber,
      number: maskSender(number),
      resendAt:
        sendsLeft > 0 && link.last_sent_at ? new Date(link.last_sent_at.getTime() + limits.spacingSeconds * 1000).toISOString() : null,
      send: deliveryState(send?.state ?? "queued"),
      sendsLeft,
      state: "fallback",
    };
  } catch {
    // Sealed under a key the service no longer holds: start again.
    return null;
  }
}

// ---------------------------------------------------------------------------
// The receipt job's side

export type LinkArrival = {
  readonly receiptId: string;
  readonly code: string;
  readonly sender: string;
  readonly senderHash: string;
  readonly spaceId: string;
  readonly spaceType: "dm" | "group";
};

export type LinkArrivalOutcome = "link_received" | "link_refused";

// One fixed refusal per sender per day, whether for a bad code or an unlinked sender.
export async function refusalSentRecently(q: Queryable, recipientHash: string) {
  const [row] = await q<{ found: boolean }[]>`
    select true as found from app.imessage_outbox
    where recipient_hash = ${recipientHash} and kind in ('link_refused', 'unlinked_sender')
      and created_at > now() - interval '24 hours'
    limit 1
  `;
  return Boolean(row);
}

// A message carrying a link code. A pending, unexpired code from a direct
// conversation, from a sender no other host has linked, records the sender for
// the host's confirmation and replies in that conversation; anything else voids
// the attempt the code names and gets at most one refusal a day. Never forwarded.
export async function receiveLinkCode(tx: Transaction, options: Pick<LinkOptions, "tokenKey" | "linkLimits">, arrival: LinkArrival): Promise<LinkArrivalOutcome> {
  const limits = { ...IMESSAGE_LINK_LIMITS, ...options.linkLimits };
  const [named] = await tx<{ host_account_id: string }[]>`
    select host_account_id from app.imessage_links where code_hash = ${hashLinkCode(arrival.code)}
  `;

  if (named) {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_link:${named.host_account_id}`}, 0))`;
    const [link] = await tx<{ id: string; host_account_id: string; state: string; live: boolean; received_by_receipt_id: string | null }[]>`
      select id, host_account_id, state, expires_at > now() as live, received_by_receipt_id
      from app.imessage_links where code_hash = ${hashLinkCode(arrival.code)}
      for update
    `;

    // A retried job finds what this message already did.
    if (link?.received_by_receipt_id === arrival.receiptId) return "link_received";

    const owner = await activeBindingOfSender(tx, arrival.senderHash);
    const usable =
      link?.state === "pending" && link.live && arrival.spaceType === "dm" && (!owner || owner.host_account_id === link.host_account_id);

    if (usable) {
      const context = senderContext(link.id);
      const sender = sealToken(options.tokenKey, arrival.sender, context);
      const space = sealToken(options.tokenKey, arrival.spaceId, context);
      await tx`
        update app.imessage_links
        set state = 'received', sender_hash = ${arrival.senderHash}, sender_ciphertext = ${sender.ciphertext},
            space_ciphertext = ${space.ciphertext}, sender_key_id = ${options.tokenKey.id}, code_ciphertext = null,
            received_by_receipt_id = ${arrival.receiptId}, confirm_by = now() + make_interval(mins => ${limits.confirmMinutes})
        where id = ${link.id}
      `;
      await recordOutbound(tx, {
        dedupeKey: `receipt:${arrival.receiptId}`,
        hostAccountId: link.host_account_id,
        kind: "link_received",
        linkId: link.id,
        recipient: { address: arrival.sender, spaceId: arrival.spaceId },
        recipientHash: arrival.senderHash,
        text: LINK_TEXTS.received,
        tokenKey: options.tokenKey,
      });
      return "link_received";
    }

    if (link && (link.state === "pending" || link.state === "received")) {
      await tx`
        update app.imessage_links
        set state = 'voided', ended_at = now(), code_ciphertext = null, sender_ciphertext = null, space_ciphertext = null
        where id = ${link.id}
      `;
    }
  }

  if (arrival.spaceType === "dm" && !(await refusalSentRecently(tx, arrival.senderHash))) {
    await recordOutbound(tx, {
      dedupeKey: `receipt:${arrival.receiptId}`,
      kind: "link_refused",
      recipient: { address: arrival.sender, spaceId: arrival.spaceId },
      recipientHash: arrival.senderHash,
      text: LINK_TEXTS.refused,
      tokenKey: options.tokenKey,
    });
  }
  return "link_refused";
}


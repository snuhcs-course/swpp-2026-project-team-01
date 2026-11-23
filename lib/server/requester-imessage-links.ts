import { z } from "zod";
import { maskedSender } from "../contracts/imessage";
import { type GuestChannel, guestLinkMessage, REQUESTER_IMESSAGE_OPERATIONS, type RequesterImessageStatus } from "../contracts/requester-imessage";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { generateLinkCode, hashLinkCode } from "./email-links";
import {
  attemptLineNumber,
  attemptMessage,
  codeContext,
  deliveryState,
  IMESSAGE_LINK_LIMITS,
  linkLockKey,
  NUMBER_INPUT,
  telegramDisplayName,
} from "./imessage-links";
import { recordOutbound } from "./imessage-outbox";
import type { PhotonRegistrar } from "./photon";
import { activeRequesterBinding, endRequesterBindings, requesterBindingName, requesterBindingRecipient } from "./requester-imessage-bindings";
import { assertIdentified, lockOpenRequest } from "./request-guard";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// Get updates in iMessage on the booking page (guest-flow-completion design 1).
// The card's commands run as the request, authorized by the booking link,
// through the command pipeline:
//   - request.imessage_link.create makes a one-time FMAT- code the request owns
//     (hashed, and sealed so a reload shows it again), valid 15 minutes, at most
//     5 an hour; the card opens Messages with guestLinkMessage(code);
//   - the receipt job's receiveLinkCode (imessage-links.ts) binds the sender as
//     soon as the code arrives and queues the welcome (link-on-code D1); the
//     card, which polls while the code is pending, then shows the binding;
//   - request.imessage_link.unlink ends the binding and voids an open attempt,
//     in the database only.
// Lock order: the request row, then the request's advisory link lock, which
// the receipt job takes alone.
// WhatsApp links the same way (guest-whatsapp-link design 2 and 4): create takes
// a channel, registers the number as for iMessage but keeps no assigned number,
// and the card opens wa.me at whatsappNumber; only a WhatsApp message completes
// the attempt, and binds the sender on that channel. A request has
// one open attempt and one active binding across both channels.
// Telegram links the same way (guest-telegram-link design 2 and 3): create takes
// channel telegram with no number, nothing is registered, and the card opens
// telegram.me/<bot>?start=<code>; /start <code> from the guest's private chat with the
// bot completes the attempt, with the sender's name sealed for the card. The
// open attempt and the active binding stay one each across the three channels.

export type RequesterLinkOptions = {
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  // The line's number; iMessage linking is unavailable without one.
  readonly lineNumber: string;
  // The WhatsApp number as digits; WhatsApp linking is unavailable without one.
  readonly whatsappNumber?: string;
  // The Telegram bot's username without "@"; Telegram linking is unavailable without one.
  readonly telegramUsername?: string;
  readonly linkLimits?: Partial<typeof IMESSAGE_LINK_LIMITS>;
  // Registers the entered number with Photon; the deployment's by default.
  readonly registrar?: PhotonRegistrar;
};

// The address a guest channel's screens name: the iMessage line, the WhatsApp
// digits or the Telegram bot's username, "" where the channel is not configured.
function channelAddress(options: Pick<RequesterLinkOptions, "lineNumber" | "whatsappNumber" | "telegramUsername">, channel: GuestChannel) {
  if (channel === "whatsapp") return options.whatsappNumber ?? "";
  if (channel === "telegram") return options.telegramUsername ?? "";
  return options.lineNumber;
}

function assertRequest(context: { actor: { kind: string; id: string }; resourceId: string }) {
  if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
  return context.actor.id;
}

async function lockRequestLinking(tx: Transaction, requestId: string) {
  const request = await lockOpenRequest(tx, requestId);
  await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ host_account_id: null, request_id: requestId, starter_hash: null })}, 0))`;
  return request;
}

async function endOpenAttempts(tx: Transaction, requestId: string, state: "voided" | "cancelled") {
  await tx`
    update app.imessage_links
    set state = ${state}, ended_at = now(), code_ciphertext = null, sender_ciphertext = null, space_ciphertext = null
    where request_id = ${requestId} and state in ('pending', 'received')
  `;
}

const noInput = z.object({}).strict() as unknown as z.ZodType<Record<string, never>>;

export function createRequesterImessageLinkCommand(
  options: RequesterLinkOptions,
): CommandDefinition<{ channel?: GuestChannel; number?: string }, { linkId: string }> {
  const limits = { ...IMESSAGE_LINK_LIMITS, ...options.linkLimits };

  return {
    // The guest's number first on iMessage and WhatsApp (imessage-number-registration
    // D1, guest-whatsapp-link D3), none on Telegram (guest-telegram-link D2);
    // iMessage unless the card asks for another channel.
    input: z.union([
      z.object({ channel: z.enum(["imessage", "whatsapp"]).optional(), number: NUMBER_INPUT }).strict(),
      z.object({ channel: z.literal("telegram") }).strict(),
    ]),
    operation: REQUESTER_IMESSAGE_OPERATIONS.create,
    async run(tx, context) {
      const requestId = assertRequest(context);
      const channel = context.input.channel ?? "imessage";
      if (!channelAddress(options, channel)) throw new CommandError("unavailable_configuration");
      const request = await lockRequestLinking(tx, requestId);
      assertIdentified(request);
      if (request.details.notificationPreference === "email_only") throw new CommandError("invalid_input");

      const [recent] = await tx<{ count: number }[]>`
        select count(*)::int as count from app.imessage_links
        where request_id = ${requestId} and created_at > now() - interval '1 hour'
      `;
      if (recent!.count >= limits.perHostHour) throw new CommandError("rate_limited");

      const lineNumber = await attemptLineNumber(options.registrar, channel, context.input.number ?? "");
      await endOpenAttempts(tx, requestId, "voided");

      const code = generateLinkCode();
      const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      const sealed = sealToken(options.tokenKey, code, codeContext(row!.id));
      await tx`
        insert into app.imessage_links (id, request_id, channel, method, code_hash, code_ciphertext, sealed_key_id, line_number, expires_at)
        values (${row!.id}, ${requestId}, ${channel}, 'code', ${hashLinkCode(code)}, ${sealed.ciphertext}, ${sealed.keyId}, ${lineNumber},
                now() + make_interval(mins => ${limits.validMinutes}))
      `;
      return { linkId: row!.id };
    },
  };
}

// **Unlink iMessage** ends the binding and an open attempt; **Cancel** on an
// open attempt (pendingOnly) ends only the attempt. A closed request still lets
// the guest unlink, so the request row is locked without the open check.
export const unlinkRequesterImessageCommand: CommandDefinition<{ pendingOnly?: boolean }, { unlinked: boolean }> = {
  input: z.object({ pendingOnly: z.boolean().optional() }).strict(),
  operation: REQUESTER_IMESSAGE_OPERATIONS.unlink,
  async run(tx, context) {
    const requestId = assertRequest(context);
    await tx`select id from app.requests where id = ${requestId} for update`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ host_account_id: null, request_id: requestId, starter_hash: null })}, 0))`;
    const unlinked = context.input.pendingOnly ? false : await endRequesterBindings(tx, requestId, "unlinked");
    await endOpenAttempts(tx, requestId, "cancelled");
    return { unlinked };
  },
};

// Choosing email ends messaging delivery and cancels any code that could link it
// again. The preference shares the request lock with edits to its JSON details.
export const emailOnlyRequesterCommand: CommandDefinition<Record<string, never>, { emailOnly: boolean }> = {
  input: noInput,
  operation: REQUESTER_IMESSAGE_OPERATIONS.emailOnly,
  async run(tx, context) {
    const requestId = assertRequest(context);
    assertIdentified(await lockRequestLinking(tx, requestId));
    await endRequesterBindings(tx, requestId, "unlinked");
    await endOpenAttempts(tx, requestId, "cancelled");
    await tx`
      update app.requests
      set details = jsonb_set(details, '{notificationPreference}', '"email_only"'::jsonb), updated_at = now()
      where id = ${requestId}
    `;
    return { emailOnly: true };
  },
};

export function shareRequesterContactCardCommand(options: RequesterLinkOptions): CommandDefinition<Record<string, never>, { outboxId: string }> {
  return {
    input: noInput,
    operation: REQUESTER_IMESSAGE_OPERATIONS.shareContactCard,
    async run(tx, context) {
      const requestId = assertRequest(context);
      await tx`select id from app.requests where id = ${requestId} for update`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ host_account_id: null, request_id: requestId, starter_hash: null })}, 0))`;
      const binding = await activeRequesterBinding(tx, requestId);
      // WhatsApp shows the business's verified name and a Telegram bot its username, so neither has a contact card.
      if (!binding || binding.channel !== "imessage") throw new CommandError("invalid_input");
      const [card] = await tx<{ state: string }[]>`select state from app.imessage_outbox where requester_binding_id = ${binding.id} and kind = 'contact_card' order by created_at desc limit 1`;
      if (card && ["queued", "dispatching", "uncertain"].includes(card.state)) throw new CommandError("rate_limited");
      const { id } = await recordOutbound(tx, {
        dedupeKey: `requester-binding:${binding.id}:card:${context.retryKey}`,
        kind: "contact_card",
        recipient: requesterBindingRecipient(options.tokenKeys, binding),
        recipientHash: binding.sender_hash,
        requestId,
        requesterBindingId: binding.id,
        tokenKey: options.tokenKey,
      });
      return { outboxId: id };
    },
  };
}

// The card's status: an open attempt first, also while a sender is linked
// (its code arriving moves the link to the new sender), then the binding, whose
// sender is masked or, on Telegram, named (link-on-code D4).
export async function readRequesterImessageStatus(
  db: Queryable,
  keys: readonly TokenKey[],
  requestId: string,
  lineNumber: string,
  whatsappNumber = "",
  telegramUsername = "",
): Promise<RequesterImessageStatus> {
  const [preference] = await db<{ email_only: boolean }[]>`
    select details ->> 'notificationPreference' = 'email_only' as email_only
    from app.requests where id = ${requestId}
  `;
  if (preference?.email_only) return { emailOnly: true, lineNumber, state: "none", telegramUsername: telegramUsername || null, whatsappNumber: whatsappNumber || null };
  if (!lineNumber && !whatsappNumber && !telegramUsername) return { state: "unavailable" };
  const numberOf = (channel: GuestChannel) => channelAddress({ lineNumber, telegramUsername, whatsappNumber }, channel);

  const [link] = await db<
    {
      id: string;
      channel: GuestChannel;
      state: "pending";
      code_ciphertext: string | null;
      sealed_key_id: string | null;
      expires_at: Date;
      line_number: string | null;
    }[]
  >`
    select id, channel, state, code_ciphertext, sealed_key_id, expires_at, line_number
    from app.imessage_links
    where request_id = ${requestId} and state = 'pending' and expires_at > now()
  `;

  try {
    if (link) {
      const code = openToken(keys, { ciphertext: link.code_ciphertext!, keyId: link.sealed_key_id! }, codeContext(link.id));
      return {
        channel: link.channel,
        code,
        expiresAt: link.expires_at.toISOString(),
        lineNumber: link.line_number ?? numberOf(link.channel),
        // Telegram's start link carries the bare code (host-telegram-channel design 6).
        message: link.channel === "telegram" ? attemptMessage("telegram", code) : guestLinkMessage(code),
        state: "pending",
      };
    }
  } catch {
    // Sealed under a key the service no longer holds: start again.
  }

  const binding = await activeRequesterBinding(db, requestId);
  if (!binding) return { lineNumber, state: "none", telegramUsername: telegramUsername || null, whatsappNumber: whatsappNumber || null };

  let sender = binding.channel === "telegram" ? telegramDisplayName(null, null) : "••••";
  try {
    sender =
      binding.channel === "telegram"
        ? (requesterBindingName(keys, binding) ?? sender)
        : maskedSender(requesterBindingRecipient(keys, binding).address);
  } catch {
    // Sealed under a key the service no longer holds: still linked.
  }
  const [card] = await db<{ state: string }[]>`select state from app.imessage_outbox where requester_binding_id = ${binding.id} and kind = 'contact_card' order by created_at desc limit 1`;
  return {
    channel: binding.channel,
    contactCard: card ? { state: deliveryState(card.state) } : null,
    linkedAt: binding.created_at.toISOString(),
    lineNumber: numberOf(binding.channel),
    sender,
    state: "linked",
  };
}

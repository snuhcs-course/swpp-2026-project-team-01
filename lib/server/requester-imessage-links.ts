import { z } from "zod";
import { displaySender } from "../contracts/imessage";
import { guestLinkMessage, REQUESTER_IMESSAGE_OPERATIONS, type RequesterImessageStatus } from "../contracts/requester-imessage";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { generateLinkCode, hashLinkCode } from "./email-links";
import { codeContext, deliveryState, IMESSAGE_LINK_LIMITS, linkLockKey, NUMBER_INPUT, registeredLineNumber, senderContext } from "./imessage-links";
import { recordOutbound } from "./imessage-outbox";
import type { PhotonRegistrar } from "./photon";
import { activeRequesterBinding, bindRequester, endRequesterBindings, requesterBindingRecipient } from "./requester-imessage-bindings";
import { assertIdentified, lockOpenRequest } from "./request-guard";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// Get updates in iMessage on the booking page (guest-flow-completion design 1).
// The card's commands run as the request, authorized by the booking link,
// through the command pipeline:
//   - request.imessage_link.create makes a one-time FMAT- code the request owns
//     (hashed, and sealed so a reload shows it again), valid 15 minutes, at most
//     5 an hour; the card opens Messages with guestLinkMessage(code);
//   - the receipt job's receiveLinkCode (imessage-links.ts) records the sender;
//   - request.imessage_link.confirm binds the recorded sender after the guest
//     saw it masked; nothing is bound before;
//   - request.imessage_link.unlink ends the binding and voids an open attempt,
//     in the database only.
// Lock order: the request row, then the request's advisory link lock, which
// the receipt job takes alone.

export type RequesterLinkOptions = {
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  // The line's number; linking is unavailable without one.
  readonly lineNumber: string;
  readonly linkLimits?: Partial<typeof IMESSAGE_LINK_LIMITS>;
  // Registers the entered number with Photon; the deployment's by default.
  readonly registrar?: PhotonRegistrar;
};

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

export function createRequesterImessageLinkCommand(options: RequesterLinkOptions): CommandDefinition<{ number: string }, { linkId: string }> {
  const limits = { ...IMESSAGE_LINK_LIMITS, ...options.linkLimits };

  return {
    // The guest's number first (imessage-number-registration D1).
    input: z.object({ number: NUMBER_INPUT }).strict(),
    operation: REQUESTER_IMESSAGE_OPERATIONS.create,
    async run(tx, context) {
      const requestId = assertRequest(context);
      if (!options.lineNumber) throw new CommandError("unavailable_configuration");
      assertIdentified(await lockRequestLinking(tx, requestId));

      const [recent] = await tx<{ count: number }[]>`
        select count(*)::int as count from app.imessage_links
        where request_id = ${requestId} and created_at > now() - interval '1 hour'
      `;
      if (recent!.count >= limits.perHostHour) throw new CommandError("rate_limited");

      const lineNumber = await registeredLineNumber(options.registrar, context.input.number);
      await endOpenAttempts(tx, requestId, "voided");

      const code = generateLinkCode();
      const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      const sealed = sealToken(options.tokenKey, code, codeContext(row!.id));
      await tx`
        insert into app.imessage_links (id, request_id, method, code_hash, code_ciphertext, sealed_key_id, line_number, expires_at)
        values (${row!.id}, ${requestId}, 'code', ${hashLinkCode(code)}, ${sealed.ciphertext}, ${sealed.keyId}, ${lineNumber},
                now() + make_interval(mins => ${limits.validMinutes}))
      `;
      return { linkId: row!.id };
    },
  };
}

export function confirmRequesterImessageLinkCommand(options: RequesterLinkOptions): CommandDefinition<{ linkId: string }, { bindingId: string }> {
  return {
    input: z.object({ linkId: z.uuid() }).strict(),
    operation: REQUESTER_IMESSAGE_OPERATIONS.confirm,
    async run(tx, context) {
      const requestId = assertRequest(context);
      const request = await lockRequestLinking(tx, requestId);

      const [link] = await tx<
        {
          id: string;
          state: string;
          open: boolean;
          sender_hash: string | null;
          sender_ciphertext: string | null;
          space_ciphertext: string | null;
          sender_key_id: string | null;
        }[]
      >`
        select id, state, confirm_by > now() as open, sender_hash, sender_ciphertext, space_ciphertext, sender_key_id
        from app.imessage_links where id = ${context.input.linkId} and request_id = ${requestId}
        for update
      `;
      if (!link || link.state !== "received" || !link.open || !link.sender_hash || !link.sender_ciphertext || !link.sender_key_id) {
        throw new CommandError("stale_revision");
      }

      const sealed = (ciphertext: string) => openToken(options.tokenKeys, { ciphertext, keyId: link.sender_key_id! }, senderContext(link.id));
      const [host] = await tx<{ display_name: string | null }[]>`
        select settings ->> 'displayName' as display_name from app.host_settings where host_account_id = ${request.host_account_id}
      `;
      const bindingId = await bindRequester(tx, options.tokenKey, {
        hostName: host?.display_name ?? "your host",
        linkId: link.id,
        requestId,
        sender: sealed(link.sender_ciphertext),
        senderHash: link.sender_hash,
        spaceId: link.space_ciphertext ? sealed(link.space_ciphertext) : null,
      });
      await tx`
        update app.imessage_links
        set state = 'linked', binding_id = ${bindingId}, ended_at = now(), code_ciphertext = null,
            sender_ciphertext = null, space_ciphertext = null
        where id = ${link.id}
      `;
      return { bindingId };
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

export function shareRequesterContactCardCommand(options: RequesterLinkOptions): CommandDefinition<Record<string, never>, { outboxId: string }> {
  return {
    input: noInput,
    operation: REQUESTER_IMESSAGE_OPERATIONS.shareContactCard,
    async run(tx, context) {
      const requestId = assertRequest(context);
      await tx`select id from app.requests where id = ${requestId} for update`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ host_account_id: null, request_id: requestId, starter_hash: null })}, 0))`;
      const binding = await activeRequesterBinding(tx, requestId);
      if (!binding) throw new CommandError("invalid_input");
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
// (confirming it moves the link to the new sender), then the binding.
export async function readRequesterImessageStatus(
  db: Queryable,
  keys: readonly TokenKey[],
  requestId: string,
  lineNumber: string,
): Promise<RequesterImessageStatus> {
  if (!lineNumber) return { state: "unavailable" };

  const [link] = await db<
    {
      id: string;
      state: "pending" | "received";
      code_ciphertext: string | null;
      sealed_key_id: string | null;
      sender_ciphertext: string | null;
      sender_key_id: string | null;
      expires_at: Date;
      confirm_by: Date | null;
      line_number: string | null;
    }[]
  >`
    select id, state, code_ciphertext, sealed_key_id, sender_ciphertext, sender_key_id, expires_at, confirm_by, line_number
    from app.imessage_links
    where request_id = ${requestId}
      and ((state = 'pending' and expires_at > now()) or (state = 'received' and confirm_by > now()))
  `;

  try {
    if (link?.state === "received") {
      const sender = openToken(keys, { ciphertext: link.sender_ciphertext!, keyId: link.sender_key_id! }, senderContext(link.id));
      return { confirmBy: link.confirm_by!.toISOString(), lineNumber, linkId: link.id, sender: displaySender(sender), state: "received" };
    }
    if (link?.state === "pending") {
      const code = openToken(keys, { ciphertext: link.code_ciphertext!, keyId: link.sealed_key_id! }, codeContext(link.id));
      return { code, expiresAt: link.expires_at.toISOString(), lineNumber: link.line_number ?? lineNumber, message: guestLinkMessage(code), state: "pending" };
    }
  } catch {
    // Sealed under a key the service no longer holds: start again.
  }

  const binding = await activeRequesterBinding(db, requestId);
  if (!binding) return { lineNumber, state: "none" };

  let sender = "••••";
  try {
    sender = displaySender(requesterBindingRecipient(keys, binding).address);
  } catch {
    // Sealed under a key the service no longer holds: still linked.
  }
  const [card] = await db<{ state: string }[]>`select state from app.imessage_outbox where requester_binding_id = ${binding.id} and kind = 'contact_card' order by created_at desc limit 1`;
  return { contactCard: card ? { state: deliveryState(card.state) } : null, linkedAt: binding.created_at.toISOString(), lineNumber, sender, state: "linked" };
}

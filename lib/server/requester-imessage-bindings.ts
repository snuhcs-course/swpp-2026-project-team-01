import type { Queryable, Transaction } from "./database";
import { recordOutbound } from "./imessage-outbox";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// A guest's linked iMessage sender for one request (guest-flow-completion design
// 2). Unlike a host binding (imessage-links.ts), a sender may be bound on several
// requests, and may be a host too; a request has one active binding. The sender
// and the conversation are sealed with requesterBindingContext(id) for replies
// and notices. A binding ends as unlinked when the guest presses Unlink
// iMessage, which suppresses the guest's undispatched messages; as ended when
// the request is withdrawn or booked, or after 30 days (the cleanup); or as moved
// when a revised request continues the conversation.

export function requesterBindingContext(bindingId: string) {
  return `requester_imessage_binding:${bindingId}`;
}

export type RequesterBinding = {
  readonly id: string;
  readonly request_id: string;
  readonly sender_hash: string;
  readonly sender_ciphertext: string;
  readonly space_ciphertext: string | null;
  readonly sealed_key_id: string;
  readonly created_at: Date;
};

export async function activeRequesterBinding(q: Queryable, requestId: string) {
  const [row] = await q<RequesterBinding[]>`
    select id, request_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id, created_at
    from app.requester_imessage_bindings where request_id = ${requestId} and state = 'active'
  `;
  return row ?? null;
}

// The binding's sender and conversation, for a reply or a notice.
export function requesterBindingRecipient(
  keys: readonly TokenKey[],
  binding: Pick<RequesterBinding, "id" | "sender_ciphertext" | "space_ciphertext" | "sealed_key_id">,
) {
  const open = (ciphertext: string) => openToken(keys, { ciphertext, keyId: binding.sealed_key_id }, requesterBindingContext(binding.id));
  return { address: open(binding.sender_ciphertext), spaceId: binding.space_ciphertext ? open(binding.space_ciphertext) : null };
}

export const REQUESTER_LINK_TEXTS = {
  received: "Got it. Go back to your booking page in your browser and tap Confirm and link to finish.",
  linked: (host: string) =>
    `Linked. You'll get updates about your request with ${host} here, and you can reply here to keep talking with Thyme. Your booking link stays in your email.`,
} as const;

// Binds the sender to the request, ending its earlier binding, and queues the
// welcome. The caller holds the request lock.
export async function bindRequester(
  tx: Transaction,
  tokenKey: TokenKey,
  binding: {
    readonly requestId: string;
    readonly linkId: string;
    readonly sender: string;
    readonly senderHash: string;
    readonly spaceId: string | null;
    readonly hostName: string;
  },
) {
  await endRequesterBindings(tx, binding.requestId, "unlinked");
  const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
  const bindingId = row!.id;
  const context = requesterBindingContext(bindingId);
  const sealedSender = sealToken(tokenKey, binding.sender, context);
  const sealedSpace = binding.spaceId === null ? null : sealToken(tokenKey, binding.spaceId, context);
  await tx`
    insert into app.requester_imessage_bindings (id, request_id, link_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id)
    values (${bindingId}, ${binding.requestId}, ${binding.linkId}, ${binding.senderHash}, ${sealedSender.ciphertext},
            ${sealedSpace?.ciphertext ?? null}, ${tokenKey.id})
  `;
  await recordOutbound(tx, {
    dedupeKey: `requester-binding:${bindingId}`,
    kind: "linked",
    linkId: binding.linkId,
    recipient: { address: binding.sender, spaceId: binding.spaceId },
    recipientHash: binding.senderHash,
    requestId: binding.requestId,
    requesterBindingId: bindingId,
    text: REQUESTER_LINK_TEXTS.linked(binding.hostName),
    tokenKey,
  });
  return bindingId;
}

// Ends the request's active binding with its sealed values cleared. Unlinking
// also suppresses the guest's messages that have not left yet; a binding that
// ends with its request still sends what was already queued (the last notice).
export async function endRequesterBindings(tx: Transaction, requestId: string, state: "unlinked" | "ended") {
  const ended = await tx<{ id: string }[]>`
    update app.requester_imessage_bindings
    set state = ${state}, ended_at = now(), sender_ciphertext = null, space_ciphertext = null
    where request_id = ${requestId} and state = 'active'
    returning id
  `;
  if (state === "unlinked" && ended.length > 0) {
    await tx`
      update app.imessage_outbox
      set state = 'suppressed', failure_category = 'unlinked', recipient_ciphertext = null, text_ciphertext = null,
          completed_at = now(), updated_at = now()
      where requester_binding_id in ${tx(ended.map((row) => row.id))} and state in ('waiting', 'queued')
    `;
  }
  return ended.length > 0;
}

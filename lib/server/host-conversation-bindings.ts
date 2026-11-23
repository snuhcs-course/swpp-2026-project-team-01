import type { Transaction } from "./database";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { activeRequesterBinding, bindRequester } from "./requester-imessage-bindings";
import type { TokenKey } from "./token-encryption";

// A request's guest conversation in its account's own linked host conversation
// (host-as-guest-messenger, R01, #61): a requester binding with no link, on the
// host binding's sender. The host binding's selected request routes its
// messages (imessage-receipts.ts), and its notices select it.


// Binds the request's guest conversation to its account's host conversation,
// replacing an earlier guest binding of the request. Without an active host
// binding nothing is bound. `select` makes it the conversation's current
// discussion (a start from that conversation); otherwise its first notice
// selects it. Returns the binding's ID, or null.
export async function bindHostConversation(
  tx: Transaction,
  keys: { readonly tokenKey: TokenKey; readonly tokenKeys: readonly TokenKey[] },
  input: { readonly requestId: string; readonly hostAccountId: string; readonly hostName: string; readonly select: boolean; readonly welcome: boolean },
): Promise<string | null> {
  const [host] = await tx<{ id: string }[]>`
    select id from app.imessage_bindings where host_account_id = ${input.hostAccountId} and state = 'active' for update
  `;
  const binding = host ? await activeBindingOfHost(tx, input.hostAccountId) : null;
  if (!binding) return null;

  const current = await activeRequesterBinding(tx, input.requestId);
  let bindingId = current && current.link_id === null && current.sender_hash === binding.sender_hash ? current.id : null;
  if (!bindingId) {
    const recipient = bindingRecipient(keys.tokenKeys, binding);
    bindingId = await bindRequester(tx, keys.tokenKey, {
      channel: binding.channel,
      hostName: input.hostName,
      linkId: null,
      requestId: input.requestId,
      sender: recipient.address,
      senderHash: binding.sender_hash,
      spaceId: recipient.spaceId,
      welcome: input.welcome,
    });
    // The host conversation's last message opens WhatsApp's window for it too.
    await tx`
      update app.requester_imessage_bindings
      set last_inbound_at = (select last_inbound_at from app.imessage_bindings where id = ${binding.id})
      where id = ${bindingId}
    `;
  }
  if (input.select) {
    await tx`update app.imessage_bindings set selected_request_id = ${input.requestId} where id = ${binding.id} and state = 'active'`;
  }
  return bindingId;
}

// The host binding of a sender whose current discussion is a sent request
// bound to that conversation, with the request's requester binding.
export type SentSelection = { readonly hostBindingId: string; readonly requestId: string; readonly requesterBindingId: string };

// Selects a request in the host conversation after one of its guest notices
// (R01 M-6): the host's next plain reply goes to that request, as a host
// notice selects a received request (D23).
export async function selectSentRequest(tx: Transaction, requesterBinding: { readonly request_id: string; readonly sender_hash: string; readonly link_id: string | null }) {
  if (requesterBinding.link_id !== null) return;
  await tx`
    update app.imessage_bindings set selected_request_id = ${requesterBinding.request_id}
    where sender_hash = ${requesterBinding.sender_hash} and state = 'active'
  `;
}


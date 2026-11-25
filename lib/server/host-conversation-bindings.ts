import { isUsableHandle, normalizeHandle } from "../contracts/handles";
import type { Transaction } from "./database";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { activeRequesterBinding, bindRequester } from "./requester-imessage-bindings";
import type { TokenKey } from "./token-encryption";

// A request's guest conversation in its account's own linked host conversation
// (host-as-guest-messenger, R01, #61): a requester binding with no link, on the
// host binding's sender. Incoming text stays in the account session; the
// requester binding delivers notices without changing focus.


// Binds the request's guest conversation to its account's host conversation,
// replacing an earlier guest binding of the request. Without an active host
// binding nothing is bound. Notification binding never selects a discussion. Returns the binding's ID, or null.
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
  return bindingId;
}

// ---------------------------------------------------------------------------
// Reading a link or handle

const HANDLE_CHARS = "[A-Za-z0-9_-]+";

// The handle a message names: a booking link on the app's origin or
// findmeatime.com (https://findmeatime.com/dodo, findmeatime.com/@dodo), an
// @handle (also the full-width ＠), or a bare handle. Null when it names none.
export function handleFromText(text: string, appOrigin: string): string | null {
  const value = text.normalize("NFKC").trim();
  let appHost = "findmeatime.com";
  try {
    appHost = new URL(appOrigin).host.toLowerCase();
  } catch {
    // Keep the product domain.
  }
  const hosts = [...new Set([appHost, "findmeatime.com", "www.findmeatime.com"])].map((host) => host.replaceAll(".", "\\."));
  const link = new RegExp(`(?:https?://)?(?:${hosts.join("|")})/@?(${HANDLE_CHARS})(?=$|[/?#\\s.,!)])`, "i").exec(value);
  const mention = /(?:^|[^\p{L}\p{N}_@])@([A-Za-z0-9_-]+)/u.exec(value);
  const bare = new RegExp(`^@?(${HANDLE_CHARS})$`).exec(value);
  const candidate = link?.[1] ?? mention?.[1] ?? bare?.[1];
  if (!candidate) return null;
  const handle = normalizeHandle(candidate);
  return isUsableHandle(handle) ? handle : null;
}

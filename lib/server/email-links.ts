import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import {
  EMAIL_LINK_CREATE_OPERATION,
  EMAIL_LINK_UNLINK_OPERATION,
  type EmailLinkStatus,
  maskAddress,
} from "../contracts/email-link";
import { type ReceivedMessage, senderHash, startsThread } from "./agentmail";
import { type CommandDefinition, CommandError } from "./commands";
import type { Database, Queryable, Transaction } from "./database";
import { recordReply } from "./email-replies";
import { LINK_CODE } from "./redaction";
import { lockOpenRequest } from "./request-guard";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// Continue by email (requester-email-channel design 4, D7 and D9). With a
// confirmed contact address, the booking page's card creates a one-time code
// that the requester sends, as shown, from that address in a new email to the
// product inbox. The code is stored as its SHA-256 and sealed so the card can
// show it again after a reload while pending; a new code voids the pending one.
// bindByCode is the receipt job's side: the code binds the thread only as the
// first message of a new thread, from the confirmed contact, with authenticated
// sender evidence, before it expires (D3); any other arrival voids it. The
// linking message never reaches the model and the thread gets a fixed
// confirmation. Unlinking ends the binding in the database only, so it works
// while AgentMail is unreachable.

export const EMAIL_LINK_LIMITS = {
  // Codes a request may create per hour.
  perRequestHour: 5,
  validMinutes: 30,
} as const;

// Crockford base32 without I, L, O and U.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateLinkCode() {
  let code = "FMAT-";
  for (let index = 0; index < 10; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function hashLinkCode(code: string) {
  return createHash("sha256").update(code.toUpperCase(), "utf8").digest("hex");
}

export function linkCodeContext(linkId: string) {
  return `email_link:${linkId}`;
}

// The first link code in a text, upper-cased, or null.
export function findLinkCode(text: string) {
  return new RegExp(LINK_CODE.source, "i").exec(text)?.[0]?.toUpperCase() ?? null;
}

function contactConfirmed(request: { contact_email: string | null; contact_confirmed_email: string | null }) {
  return Boolean(
    request.contact_email &&
      request.contact_confirmed_email &&
      request.contact_email.toLowerCase() === request.contact_confirmed_email.toLowerCase(),
  );
}

export function createEmailLinkCommand(options: {
  readonly tokenKey: TokenKey;
  readonly limits?: Partial<typeof EMAIL_LINK_LIMITS>;
}): CommandDefinition<Record<string, never>, { linkId: string }> {
  const limits = { ...EMAIL_LINK_LIMITS, ...options.limits };

  return {
    input: z.object({}).strict(),
    operation: EMAIL_LINK_CREATE_OPERATION,
    async run(tx, context) {
      if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) {
        throw new CommandError("forbidden");
      }

      const request = await lockOpenRequest(tx, context.actor.id);
      if (!contactConfirmed(request)) throw new CommandError("invalid_input");

      const [recent] = await tx<{ count: number }[]>`
        select count(*)::int as count from app.email_links
        where request_id = ${request.id} and created_at > now() - interval '1 hour'
      `;
      if (recent!.count >= limits.perRequestHour) throw new CommandError("rate_limited");

      await tx`
        update app.email_links set state = 'voided', ended_at = now(), code_ciphertext = null, code_key_id = null
        where request_id = ${request.id} and state = 'pending'
      `;

      const code = generateLinkCode();
      const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      const sealed = sealToken(options.tokenKey, code, linkCodeContext(row!.id));
      await tx`
        insert into app.email_links (id, request_id, code_hash, code_ciphertext, code_key_id, expires_at)
        values (${row!.id}, ${request.id}, ${hashLinkCode(code)}, ${sealed.ciphertext}, ${sealed.keyId},
                now() + make_interval(mins => ${limits.validMinutes}))
      `;

      return { linkId: row!.id };
    },
  };
}

// **Unlink email** ends the active binding and voids a pending code; **Cancel**
// on a pending code (pendingOnly) voids only the code.
export function unlinkEmailCommand(): CommandDefinition<{ pendingOnly?: boolean }, { unlinked: boolean }> {
  return {
    input: z.object({ pendingOnly: z.boolean().optional() }).strict(),
    operation: EMAIL_LINK_UNLINK_OPERATION,
    async run(tx, context) {
      if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) {
        throw new CommandError("forbidden");
      }

      await tx`select id from app.requests where id = ${context.actor.id} for update`;
      const ended = context.input.pendingOnly
        ? { count: 0 }
        : await tx`
            update app.email_threads set state = 'unlinked', ended_at = now()
            where request_id = ${context.actor.id} and state = 'active'
          `;
      await tx`
        update app.email_links set state = 'voided', ended_at = now(), code_ciphertext = null, code_key_id = null
        where request_id = ${context.actor.id} and state = 'pending'
      `;

      return { unlinked: ended.count > 0 };
    },
  };
}

export async function readEmailLinkStatus(
  db: Queryable,
  keys: readonly TokenKey[],
  requestId: string,
  inbox: string,
): Promise<EmailLinkStatus | null> {
  if (!inbox) return { state: "unavailable" };

  const [request] = await db<{ contact_email: string | null; contact_confirmed_email: string | null }[]>`
    select contact_email, contact_confirmed_email from app.requests where id = ${requestId}
  `;
  if (!request) return null;

  const [binding] = await db<{ bound_at: Date }[]>`
    select bound_at from app.email_threads where request_id = ${requestId} and state = 'active'
  `;
  const linked: EmailLinkStatus | null =
    binding && request.contact_email
      ? { address: maskAddress(request.contact_email), inbox, linkedAt: binding.bound_at.toISOString(), state: "linked" }
      : null;

  if (!contactConfirmed(request)) return linked ?? { inbox, state: "needs_confirmation" };

  // A pending code shows first, also while another thread is linked: sending
  // it moves the conversation to the new thread.
  const [link] = await db<{ id: string; code_ciphertext: string; code_key_id: string; expires_at: Date }[]>`
    select id, code_ciphertext, code_key_id, expires_at from app.email_links
    where request_id = ${requestId} and state = 'pending' and expires_at > now() and code_ciphertext is not null
  `;

  if (!link) return linked ?? { inbox, state: "none" };

  try {
    const code = openToken(keys, { ciphertext: link.code_ciphertext, keyId: link.code_key_id }, linkCodeContext(link.id));
    return { code, expiresAt: link.expires_at.toISOString(), inbox, state: "pending" };
  } catch {
    // Sealed under a key the service no longer holds: make a new one.
    return linked ?? { inbox, state: "none" };
  }
}

export type LinkOutcome = "linked" | "ignored";

type Receipt = { readonly id: string; readonly inbox_id: string; readonly thread_id: string; readonly message_id: string };

const CONFIRMATION = {
  en: (host: string) => `This thread is now linked to your request with ${host}. Reply here to continue.`,
  ko: (host: string) => `이 스레드가 ${host}님과의 요청에 연결되었습니다. 여기에 답장하면 이어서 진행됩니다.`,
};

async function voidLink(tx: Transaction, linkId: string) {
  await tx`
    update app.email_links set state = 'voided', ended_at = now(), code_ciphertext = null, code_key_id = null
    where id = ${linkId} and state = 'pending'
  `;
}

// The receipt job's side of linking. Every condition must hold; otherwise a
// pending code is voided, since it was seen somewhere it should not be.
export async function bindByCode(
  db: Database,
  tokenKey: TokenKey,
  receipt: Receipt,
  message: ReceivedMessage,
  code: string,
  address: string,
  authenticated: boolean,
): Promise<LinkOutcome> {
  return (await db.begin(async (tx) => {
    const [link] = await tx<
      { id: string; request_id: string; state: string; expired: boolean; thread_binding_id: string | null }[]
    >`
      select id, request_id, state, expires_at <= now() as expired, thread_binding_id
      from app.email_links where code_hash = ${hashLinkCode(code)}
      for update
    `;

    if (!link) return "ignored";

    // A retried job finds the binding this message already made.
    if (link.state === "consumed" && link.thread_binding_id) {
      const [own] = await tx<{ id: string }[]>`
        select id from app.email_threads where id = ${link.thread_binding_id} and bound_by_receipt_id = ${receipt.id}
      `;
      return own ? "linked" : "ignored";
    }

    if (link.state !== "pending") return "ignored";

    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.email_thread:${receipt.inbox_id}:${receipt.thread_id}`}, 0))`;
    const [bound] = await tx<{ id: string }[]>`
      select id from app.email_threads where inbox_id = ${receipt.inbox_id} and thread_id = ${receipt.thread_id} and state = 'active'
    `;

    let request: Awaited<ReturnType<typeof lockOpenRequest>> | null = null;

    try {
      request = await lockOpenRequest(tx, link.request_id);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
    }

    const matches =
      authenticated &&
      !link.expired &&
      !bound &&
      startsThread(message) &&
      request !== null &&
      contactConfirmed(request) &&
      request.contact_confirmed_email!.toLowerCase() === address;

    if (!matches) {
      await voidLink(tx, link.id);
      return "ignored";
    }

    await tx`
      update app.email_threads set state = 'unlinked', ended_at = now()
      where request_id = ${request!.id} and state = 'active'
    `;
    const [binding] = await tx<{ id: string }[]>`
      insert into app.email_threads (request_id, inbox_id, thread_id, origin, sender_hash, bound_by_receipt_id, last_message_id)
      values (${request!.id}, ${receipt.inbox_id}, ${receipt.thread_id}, 'linked', ${senderHash(tokenKey, address)},
              ${receipt.id}, ${receipt.message_id})
      returning id
    `;
    await tx`
      update app.email_links
      set state = 'consumed', ended_at = now(), code_ciphertext = null, code_key_id = null, thread_binding_id = ${binding!.id}
      where id = ${link.id}
    `;

    const [host] = await tx<{ name: string | null }[]>`
      select s.settings ->> 'displayName' as name from app.host_settings s where s.host_account_id = ${request!.host_account_id}
    `;
    const language = request!.details.language === "ko" ? "ko" : "en";
    await recordReply(tx, {
      bindingId: binding!.id,
      dedupeKey: `receipt:${receipt.id}`,
      inboxId: receipt.inbox_id,
      kind: "link_confirmation",
      language,
      replyToMessageId: receipt.message_id,
      requestId: request!.id,
      text: CONFIRMATION[language](host?.name?.trim() || "your host"),
    });

    return "linked";
  })) as LinkOutcome;
}

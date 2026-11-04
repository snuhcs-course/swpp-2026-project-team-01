import { database, type Database, type Transaction } from "./database";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { TELEGRAM_BUTTONS_JOB } from "./imessage-notices";
import { recordOutbound, signalText } from "./imessage-outbox";
import type { JobHandler } from "./jobs";
import { publishJob } from "./jobs";
import { TELEGRAM_EDIT_HOURS, type TelegramButtons } from "./telegram";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Telegram's own follow-up jobs (host-telegram-channel design 7 and 8).
//
// telegram_buttons (D9) removes inline buttons that no longer name what the host
// can decide: for a request, every accepted message whose decision buttons name
// a version other than the one awaiting approval now (all of them once the
// request left awaiting approval); for a host, every settings confirmation once
// settings were saved. Each gets one edit_markup row keyed by the message's row,
// within Telegram's 48-hour edit limit and only while the binding it went to is
// active. The message text stays as it was.
//
// telegram_typing (design 8) repeats the typing indicator while a forwarded
// message's turn runs: every 5 seconds while its reply still waits for the
// turn, at most 12 indicators in all, each a best-effort signal row.

export const TELEGRAM_TYPING_JOB = "telegram_typing";
export const TYPING_INTERVAL_SECONDS = 5;
export const TYPING_MAX = 12;

export type TelegramJobDependencies = {
  readonly db: Database;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
};

function dependenciesFromEnvironment(): TelegramJobDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return { db: database(), tokenKey, tokenKeys: [tokenKey] };
}

type Buttoned = {
  readonly id: string;
  readonly binding_id: string;
  readonly host_account_id: string;
  readonly request_id: string | null;
  readonly provider_message_id: string;
  readonly buttons: TelegramButtons;
};

// Records the edits for the buttoned rows given, to the host's active Telegram binding.
async function retire(tx: Transaction, deps: TelegramJobDependencies, rows: readonly Buttoned[]) {
  let queued = 0;
  for (const row of rows) {
    const binding = await activeBindingOfHost(tx, row.host_account_id);
    if (binding?.id !== row.binding_id) continue;
    const { created } = await recordOutbound(tx, {
      bindingId: binding.id,
      channel: "telegram",
      dedupeKey: `edit:${row.id}`,
      hostAccountId: row.host_account_id,
      kind: "edit_markup",
      recipient: bindingRecipient(deps.tokenKeys, binding),
      recipientHash: binding.sender_hash,
      requestId: row.request_id,
      text: row.provider_message_id,
      tokenKey: deps.tokenKey,
    });
    if (created) queued += 1;
  }
  return queued;
}

// The accepted rows with buttons, not yet edited and still editable, of a request or of a host's settings.
function buttoned(tx: Transaction, where: { readonly requestId: string } | { readonly hostAccountId: string }) {
  const requestId = "requestId" in where ? where.requestId : null;
  const hostAccountId = "hostAccountId" in where ? where.hostAccountId : null;
  return tx<(Buttoned & { version: number | null })[]>`
    select o.id, o.binding_id, o.host_account_id, o.request_id, o.provider_message_id, o.buttons,
           (o.buttons ->> 'version')::int as version
    from app.imessage_outbox o
    where o.channel = 'telegram' and o.state = 'accepted' and o.buttons is not null
      and o.binding_id is not null and o.host_account_id is not null and o.provider_message_id is not null
      and o.completed_at > now() - make_interval(hours => ${TELEGRAM_EDIT_HOURS})
      and (${requestId}::uuid is null or (o.request_id = ${requestId} and o.buttons ->> 'kind' = 'decision'))
      and (${hostAccountId}::uuid is null or (o.host_account_id = ${hostAccountId} and o.buttons ->> 'kind' = 'settings'))
      and not exists (select 1 from app.imessage_outbox e where e.kind = 'edit_markup' and e.dedupe_key = 'edit:' || o.id::text)
    order by o.created_at
  `;
}

export function createTelegramButtonsHandler(load: () => TelegramJobDependencies = dependenciesFromEnvironment): JobHandler {
  return async (tx, job) => {
    const deps = load();
    const hostAccountId = typeof job.payload.hostAccountId === "string" ? job.payload.hostAccountId : null;
    if (hostAccountId) return { queued: await retire(tx, deps, await buttoned(tx, { hostAccountId })) };

    const requestId = typeof job.payload.requestId === "string" ? job.payload.requestId : null;
    if (!requestId) return { queued: 0 };

    // The version the host can still decide, if any.
    const [request] = await tx<{ state: string; version: number | null }[]>`
      select r.state, (select max(p.version) from app.proposals p where p.request_id = r.id) as version
      from app.requests r where r.id = ${requestId}
    `;
    const current = request?.state === "awaiting_host_approval" ? request.version : null;
    const stale = (await buttoned(tx, { requestId })).filter((row) => row.version !== current);
    return { queued: await retire(tx, deps, stale) };
  };
}

// After settings were saved from a button or a typed confirm: the confirmations shown before are spent.
export async function enqueueSettingsButtonRetirement(tx: Transaction, hostAccountId: string, retryKey: string) {
  await publishJob(tx, { dedupeKey: `settings:${hostAccountId}:${retryKey}`, kind: TELEGRAM_BUTTONS_JOB, payload: { hostAccountId } });
}

// Starts the typing repeats for a forwarded Telegram message whose reply waits on `turnOutboxId`.
export async function startTypingRepeats(tx: Transaction, receiptId: string, turnOutboxId: string) {
  await publishJob(tx, {
    dedupeKey: `receipt:${receiptId}:typing:2`,
    kind: TELEGRAM_TYPING_JOB,
    maxAttempts: 1,
    payload: { count: 2, receiptId, turnOutboxId },
    runAfter: new Date(Date.now() + TYPING_INTERVAL_SECONDS * 1000),
  });
}

export function createTelegramTypingHandler(load: () => TelegramJobDependencies = dependenciesFromEnvironment): JobHandler {
  return async (tx, job) => {
    const receiptId = typeof job.payload.receiptId === "string" ? job.payload.receiptId : null;
    const turnOutboxId = typeof job.payload.turnOutboxId === "string" ? job.payload.turnOutboxId : null;
    const count = typeof job.payload.count === "number" ? job.payload.count : TYPING_MAX + 1;
    if (!receiptId || !turnOutboxId || count > TYPING_MAX) return { typing: false };

    // The reply is ready once its turn ended (or its session failed), even
    // before the send job freezes it.
    const [turn] = await tx<{ state: string; turn_over: boolean; binding_id: string | null; host_account_id: string | null }[]>`
      select o.state, coalesce(i.state = 'completed' or s.state = 'failed', true) as turn_over, o.binding_id, o.host_account_id
      from app.imessage_outbox o
      left join app.conversation_inputs i on i.id = o.input_id
      left join app.agent_sessions s on s.session_id = i.session_id
      where o.id = ${turnOutboxId}
    `;
    if (turn?.state !== "waiting" || turn.turn_over || !turn.binding_id || !turn.host_account_id) return { typing: false };

    const deps = load();
    const binding = await activeBindingOfHost(tx, turn.host_account_id);
    if (binding?.id !== turn.binding_id) return { typing: false };

    await recordOutbound(tx, {
      bindingId: binding.id,
      channel: "telegram",
      dedupeKey: `receipt:${receiptId}:typing:${count}`,
      hostAccountId: turn.host_account_id,
      kind: "signal",
      recipient: bindingRecipient(deps.tokenKeys, binding),
      recipientHash: binding.sender_hash,
      text: signalText({ messageId: null, reaction: null, typing: true }),
      tokenKey: deps.tokenKey,
    });
    if (count < TYPING_MAX) {
      await publishJob(tx, {
        dedupeKey: `receipt:${receiptId}:typing:${count + 1}`,
        kind: TELEGRAM_TYPING_JOB,
        maxAttempts: 1,
        payload: { count: count + 1, receiptId, turnOutboxId },
        runAfter: new Date(Date.now() + TYPING_INTERVAL_SECONDS * 1000),
      });
    }
    return { typing: true };
  };
}

import { createHmac, randomInt } from "node:crypto";
import { z } from "zod";
import {
  displaySender,
  maskedSender,
  type ImessageDeliveryState,
  type ImessageStatus,
  type LinkChannels,
  linkMessage,
  normalizeNumber,
} from "../contracts/imessage";
import { configuredChannels, type MessagingChannel } from "../contracts/messaging-channel";
import { defaultCalendarRoles, readDefaultRoleCalendars } from "./calendar-roles";
import { SETUP_OVERVIEW, withoutSetupStep, withSetupStep } from "../contracts/setup-progress";
import { hostConversationLanguage } from "./channel-language";
import { channelReplies } from "./channel-texts";
import { googleCalendarConfigFromEnvironment, type GoogleCalendarDependencies, type CalendarListEntry } from "./google-calendar";
import { lockActiveHost, queueHoursQuestion, readLatestAnalysis } from "./analysis";
import { type CommandDefinition, CommandError } from "./commands";
import type { Database, Queryable, Transaction } from "./database";
import { generateLinkCode, hashLinkCode } from "./email-links";
import { recordOutbound } from "./imessage-outbox";
import { PERMISSION_REASONS } from "../contracts/permission-reasons";
import { bindRequester } from "./requester-imessage-bindings";
import { lockOpenRequest } from "./request-guard";
import { imessageContinuationUrl } from "./imessage-continuation";
import { photonRegistrar, type PhotonRegistrar } from "./photon";
import { channelHash, imessageHash } from "./photon-receiver";
import { calendarUsable, readReadiness, savedSettingsOnce } from "./readiness";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// Linking a host's iMessage (host-imessage-channel design 4, 6 and 11; D3, D5,
// D6, D13). The card's commands run as the signed-in host through the command
// pipeline:
//   - imessage.link.create makes a one-time FMAT- code (hashed, and sealed so a
//     reload shows it again), valid 15 minutes, at most 5 an hour; the card opens
//     Messages with linkMessage(code) and the line's number;
//   - receiveLinkCode is the receipt job's side: a pending code arriving from a
//     direct conversation binds its sender at once and queues the linked
//     message there (link-on-code D1); any other arrival voids the attempt.
//     The card, which polls while the code is pending, then shows the binding
//     with Not my number, which is imessage.unlink (D2);
//   - imessage.link.send_code and imessage.link.verify_code are the fallback: a
//     six-digit code the line sends to an entered number, typed back here;
//   - imessage.unlink ends the binding in the database only, so it works while
//     Photon is unreachable; imessage.contact_card.share queues one contact card.
// A host has one open attempt and one active binding; a sender belongs to one
// host. Lock order: the account share lock, then the host's advisory link lock,
// then the line's fallback lock.
// WhatsApp links the same way (host-whatsapp-channel design 5 and 6, D5, D6): an
// attempt is created for a channel and only that channel's message completes it;
// the one active binding a host has may be on either channel, so confirming a
// sender of one channel ends the binding on the other and suppresses what was
// still queued for it. The fallback code and the contact card are iMessage only.
// Telegram links the same way (host-telegram-channel design 5 and 6, D5, D6): the
// card opens telegram.me/<bot>?start=<code>, and /start <code> (or the code as text)
// from the host's private chat with the bot completes a Telegram attempt, so the
// bot's first message is the linked welcome. The sender's first name and
// @username are sealed beside the sender (sender_name_ciphertext) and shown on
// the card instead of a user ID.
// What stands in for the confirmation step that link-on-code removed (D3): the
// code is single-use (a used, voided or replaced code never links again), valid
// 15 minutes, owned by the signed-in account, the booking page's request or the
// start's browser that showed it, at most 5 an hour per owner, and refused from
// a group or another channel. A code that leaks before it is used links whoever
// sends it first; Not my number (unlink) and a new code are the recovery.

export const IMESSAGE_LINK_LIMITS = {
  // Link codes a host may create per hour.
  perHostHour: 5,
  validMinutes: 15,
  // How long a code that arrived from the iMessage start waits for the
  // browser's Google sign-in, which binds its sender (link-on-code D3).
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
  readonly liveCalendars?: readonly CalendarListEntry[] | null;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  // The line's number; iMessage linking is unavailable without one.
  readonly lineNumber: string;
  // The WhatsApp number as digits; WhatsApp linking is unavailable without one.
  readonly whatsappNumber?: string;
  // The Telegram bot's username without "@"; Telegram linking is unavailable without one.
  readonly telegramUsername?: string;
  // The canonical origin (APP_ORIGIN) that links in Thyme's messages point to.
  readonly origin: string;
  readonly fallbackLimits?: Partial<typeof IMESSAGE_FALLBACK_LIMITS>;
  readonly linkLimits?: Partial<typeof IMESSAGE_LINK_LIMITS>;
  // Registers the entered number with Photon; the deployment's by default.
  readonly registrar?: PhotonRegistrar;
};

// The entered number for an iMessage code attempt (imessage-number-registration
// design 1 and 2): it is registered as a Photon user, and the attempt keeps the
// shared-pool number Photon assigned, which the screens address. The number
// itself is not stored. A refused number or a full project is invalid input or
// unavailable configuration; a lost answer is unavailable configuration too, so
// the person can try again.
// A WhatsApp attempt registers the number the same way (guest-whatsapp-link D3)
// but keeps no assigned number: Photon's is an iMessage pool number, and the
// WhatsApp screens address PHOTON_WHATSAPP_NUMBER. Telegram takes no number.
export const NUMBER_INPUT = z.string().trim().min(1).max(40);

// The line_number an attempt on the channel keeps, after registering the number;
// null for WhatsApp, and nothing registered for Telegram.
export async function attemptLineNumber(registrar: PhotonRegistrar | undefined, channel: MessagingChannel, entered: string) {
  if (channel === "telegram") return null;
  const assigned = await registeredLineNumber(registrar, entered);
  return channel === "imessage" ? assigned : null;
}

export async function registeredLineNumber(registrar: PhotonRegistrar | undefined, entered: string) {
  const number = normalizeNumber(entered);
  if (!number) throw new CommandError("invalid_input");
  const registration = await (registrar ?? photonRegistrar()).send(number);
  if (registration.status !== "registered") throw new CommandError("unavailable_configuration");
  return registration.lineNumber;
}

export function fallbackDailyLimit(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = Number(env.PHOTON_FALLBACK_DAILY_LIMIT);
  return Number.isInteger(value) && value >= 0 ? value : IMESSAGE_FALLBACK_LIMITS.perLineDay;
}

// Why the welcome asks for Calendar although the host signed in with Google,
// read from the stored grant (imessage-onboarding-calendar-consent D2, #407):
// Google reported no Calendar permission (unticked boxes, or scopes that could
// not be read, which the row cannot tell apart), gave no refresh token, or
// rejected the stored one.
export type CalendarAskCause = "not_granted" | "no_lasting_access" | "ended";

export const CALENDAR_ASK_CAUSES: Readonly<Record<CalendarAskCause, string>> = {
  not_granted: "Google didn't confirm Calendar permission when you signed in, so I can't see your calendar yet.",
  no_lasting_access: "Google didn't give lasting Calendar access when you signed in, so it needs one more consent.",
  ended: "Your Google Calendar access has ended, so it needs connecting again.",
};

export const LINK_TEXTS = {
  // An attempt from the iMessage start has no host until a browser signs in (D15);
  // the link lets the sender sign in from this thread (D19), and the sign-in
  // links this conversation (link-on-code D3).
  receivedBeforeSignIn: (url: string) =>
    `Got it. To finish linking, sign in with Google and connect your calendar: ${url}\n${PERMISSION_REASONS.en.googleSignIn}`,
  refused: "That link code is not valid any more. Start again from Connect iMessage in Find Me a Time.",
  refusedWhatsApp: "That link code is not valid any more. Start again from Connect WhatsApp in Find Me a Time.",
  refusedTelegram: "That link code is not valid any more. Start again from Connect Telegram in Find Me a Time.",
  // A ready host gets this; one still setting up gets a welcome into setup here (D19).
  linked: "Linked. Send help for what I can do here.",
  // With the reason Calendar is still not usable when the host has a Google
  // grant (#407); a host with none is simply asked.
  welcomeCalendar: (url: string, cause: CalendarAskCause | null = null) =>
    `You're connected! I'm Thyme, and we can set up your meetings right here. ${SETUP_OVERVIEW.en}\n${withSetupStep("en", "calendar", `First, connect Google Calendar: ${url}`)}\n${cause ? `${CALENDAR_ASK_CAUSES[cause]}\n` : ""}${PERMISSION_REASONS.en.googleSignIn}`,
  backFromGoogle: "You're back from Google. Let's keep going here: tell me your meeting preferences, or send setup to see what's next.",
  fallbackCode: (code: string, minutes: number) => `Your Find Me a Time code is ${code}. It expires in ${minutes} minutes.`,
} as const;

// The category of a fallback send to a number another host has linked.
export const FOREIGN_BINDING = "foreign_binding";

// Fixed replies to senders who are not linked (bad codes and unlinked senders)
// across the line per rolling 24 hours, so many sender IDs cannot make the line
// send many first messages.
export const LINE_REFUSALS_PER_DAY = 200;

// What a deployment can link to (the card's channels).
export function linkChannels(options: Pick<LinkOptions, "lineNumber" | "whatsappNumber" | "telegramUsername">): LinkChannels {
  return { imessage: options.lineNumber || null, telegram: options.telegramUsername || null, whatsapp: options.whatsappNumber || null };
}

function refusedText(channel: MessagingChannel) {
  if (channel === "whatsapp") return LINK_TEXTS.refusedWhatsApp;
  if (channel === "telegram") return LINK_TEXTS.refusedTelegram;
  return LINK_TEXTS.refused;
}

// A Telegram sender as the browser shows it (design 3): "Dohyeon (@dohyeon)",
// either part alone, or a plain word when the profile gave neither.
export function telegramDisplayName(firstName: string | null, username: string | null) {
  if (firstName && username) return `${firstName} (@${username})`;
  if (firstName) return firstName;
  if (username) return `@${username}`;
  return "your Telegram account";
}

function numberOf(channels: LinkChannels, channel: MessagingChannel) {
  return channels[channel] ?? "";
}

export function codeContext(linkId: string) {
  return `imessage_link_code:${linkId}`;
}

export function senderContext(linkId: string) {
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

// The advisory lock an attempt's changes take: its host's, a guest's request's
// (guest-flow-completion design 1), or before sign-in its starter's.
export function linkLockKey(owner: {
  readonly host_account_id: string | null;
  readonly request_id?: string | null;
  readonly starter_hash: string | null;
}) {
  if (owner.host_account_id) return `app.imessage_link:${owner.host_account_id}`;
  if (owner.request_id) return `app.imessage_link_request:${owner.request_id}`;
  return `app.imessage_link_start:${owner.starter_hash}`;
}

export async function lockHostLinking(tx: Transaction, hostAccountId: string) {
  await lockActiveHost(tx, hostAccountId);
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_link:${hostAccountId}`}, 0))`;
}

// Open attempts end with every sealed value cleared (the sender's name with the
// sender, by trigger).
export async function endOpenAttempts(tx: Transaction, hostAccountId: string, state: "voided" | "cancelled") {
  await tx`
    update app.imessage_links
    set state = ${state}, ended_at = now(), code_ciphertext = null, phone_ciphertext = null, sender_ciphertext = null,
        space_ciphertext = null, fallback_code_hash = null
    where host_account_id = ${hostAccountId} and state in ('pending', 'received')
  `;
}

type ActiveBinding = {
  readonly id: string;
  readonly channel: MessagingChannel;
  readonly host_account_id: string;
  readonly sender_hash: string;
  readonly sender_ciphertext: string;
  readonly sender_name_ciphertext: string | null;
  readonly space_ciphertext: string | null;
  readonly sealed_key_id: string;
  readonly linked_at: Date;
};

export async function activeBindingOfHost(q: Queryable, hostAccountId: string) {
  const [row] = await q<ActiveBinding[]>`
    select id, channel, host_account_id, sender_hash, sender_ciphertext, sender_name_ciphertext, space_ciphertext, sealed_key_id,
           linked_at
    from app.imessage_bindings where host_account_id = ${hostAccountId} and state = 'active'
  `;
  return row ?? null;
}

export async function activeBindingOfSender(q: Queryable, senderHash: string) {
  const [row] = await q<ActiveBinding[]>`
    select id, channel, host_account_id, sender_hash, sender_ciphertext, sender_name_ciphertext, space_ciphertext, sealed_key_id,
           linked_at
    from app.imessage_bindings where sender_hash = ${senderHash} and state = 'active'
  `;
  return row ?? null;
}

// The sender's active binding, row-locked until the transaction ends, so an
// unlink waits for a message already being processed instead of racing it.
export async function lockActiveBindingOfSender(tx: Transaction, senderHash: string) {
  const [row] = await tx<ActiveBinding[]>`
    select id, channel, host_account_id, sender_hash, sender_ciphertext, sender_name_ciphertext, space_ciphertext, sealed_key_id,
           linked_at
    from app.imessage_bindings where sender_hash = ${senderHash} and state = 'active'
    for update
  `;
  return row ?? null;
}

// The binding's sender and conversation, for a reply.
export function bindingRecipient(keys: readonly TokenKey[], binding: Pick<ActiveBinding, "id" | "sender_ciphertext" | "space_ciphertext" | "sealed_key_id">) {
  const open = (ciphertext: string) => openToken(keys, { ciphertext, keyId: binding.sealed_key_id }, bindingContext(binding.id));
  return { address: open(binding.sender_ciphertext), spaceId: binding.space_ciphertext ? open(binding.space_ciphertext) : null };
}

// The sender is another host's: nothing was written, and the caller refuses.
export class SenderHeldError extends CommandError {
  constructor() {
    super("invalid_input");
    this.name = "SenderHeldError";
  }
}

// What binding a sender needs: the keys, the origin its welcome links to, and the
// live calendar list where the caller could read one outside the transaction.
export type BindOptions = Pick<LinkOptions, "tokenKey" | "tokenKeys" | "origin" | "liveCalendars">;

// Binds a sender to the host, ending the host's earlier binding, and queues the
// linked message. The caller holds the host's link lock. A Telegram sender's
// display name is sealed with it.
async function bind(
  tx: Transaction,
  options: BindOptions,
  hostAccountId: string,
  linkId: string,
  sender: string,
  spaceId: string | null,
  channel: MessagingChannel = "imessage",
  senderName: string | null = null,
) {
  const senderHash = channelHash(options.tokenKey, channel, "sender", sender);
  // A receipt being processed holds its binding row while it waits on other
  // connections, which Postgres cannot see; a bounded wait here keeps a lock
  // queue behind this command from turning into an undetected cycle.
  await tx`set local lock_timeout = '5s'`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_sender:${senderHash}`}, 0))`;
  const owner = await activeBindingOfSender(tx, senderHash);
  if (owner && owner.host_account_id !== hostAccountId) throw new SenderHeldError();

  // The host's earlier binding ends, on any channel (D5), and nothing still
  // queued for it goes out.
  const ended = await tx<{ id: string }[]>`
    update app.imessage_bindings set state = 'unlinked', ended_at = now(), sender_ciphertext = null, space_ciphertext = null
    where host_account_id = ${hostAccountId} and state = 'active'
    returning id
  `;
  await suppressQueued(tx, ended.map((binding) => binding.id), "replaced");
  const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
  const bindingId = row!.id;
  const context = bindingContext(bindingId);
  const sealedSender = sealToken(options.tokenKey, sender, context);
  const sealedSpace = spaceId === null ? null : sealToken(options.tokenKey, spaceId, context);
  const sealedName = senderName === null ? null : sealToken(options.tokenKey, senderName, context);
  await tx`
    insert into app.imessage_bindings
      (id, channel, host_account_id, link_id, sender_hash, sender_ciphertext, sender_name_ciphertext, space_ciphertext, sealed_key_id, last_inbound_at)
    values (${bindingId}, ${channel}, ${hostAccountId}, ${linkId}, ${senderHash}, ${sealedSender.ciphertext}, ${sealedName?.ciphertext ?? null},
            ${sealedSpace?.ciphertext ?? null}, ${options.tokenKey.id},
            -- The link message is the host's last message so far; WhatsApp's window starts there (design 7).
            (select r.received_at from app.imessage_links l join app.imessage_receipts r on r.id = l.received_by_receipt_id where l.id = ${linkId}))
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
    text: await linkedText(tx, hostAccountId, options),
    tokenKey: options.tokenKey,
  });
  const analysis = await readLatestAnalysis(tx, hostAccountId);
  if (analysis && analysis.state !== "pending") {
    await queueHoursQuestion(tx, hostAccountId, options.tokenKeys, analysis.state === "completed" ? analysis.evidence : null, analysis.id);
  }
  // Photon's deliverability guidance: once the host saves the line's contact
  // card, iMessage stops offering Report Junk. It follows the welcome, once
  // per binding (D22, design 18); WhatsApp shows the verified business name instead.
  if (channel === "imessage") {
    await recordOutbound(tx, {
      bindingId,
      dedupeKey: `binding:${bindingId}:card:linked`,
      delaySeconds: CARD_AFTER_WELCOME_SECONDS,
      hostAccountId,
      kind: "contact_card",
      recipient: { address: sender, spaceId },
      recipientHash: senderHash,
      tokenKey: options.tokenKey,
    });
  }
  return bindingId;
}

// The card's send waits this long, so it arrives after the welcome.
export const CARD_AFTER_WELCOME_SECONDS = 15;

// Undispatched host-private messages of ended bindings go no further.
async function suppressQueued(tx: Transaction, bindingIds: readonly string[], category: string) {
  if (bindingIds.length === 0) return;
  await tx`
    update app.imessage_outbox
    set state = 'suppressed', failure_category = ${category}, recipient_ciphertext = null, text_ciphertext = null,
        completed_at = now(), updated_at = now()
    where binding_id = any(${bindingIds}::uuid[]) and state in ('waiting', 'queued')
  `;
}

// Google sign-in asking for Calendar that returns to the iMessage conversation (D19).
export function calendarConnectUrl(origin: string) {
  return `${origin}/auth/sign-in?consent=calendar&return=imessage`;
}

// The linked message (D19): a ready host is told what Thyme can do; a host still
// setting up is welcomed into setup in this conversation, with Calendar first when
// it is not usable yet, since setup cannot go further without it.
async function linkedText(tx: Transaction, hostAccountId: string, options: BindOptions) {
  if ((await readReadiness(tx, hostAccountId)).ready) return LINK_TEXTS.linked;
  const [grant] = await tx<{ cause: CalendarAskCause; usable: boolean }[]>`
    select ${calendarUsable(tx)} as usable,
      case
        when g.invalidated_at is not null then 'ended'
        when g.refresh_token_ciphertext is null then 'no_lasting_access'
        else 'not_granted'
      end as cause
    from app.provider_grants g where g.host_account_id = ${hostAccountId}
  `;
  if (!grant?.usable) return LINK_TEXTS.welcomeCalendar(calendarConnectUrl(options.origin), grant?.cause ?? null);
  const roles = await defaultCalendarRoles(tx, hostAccountId, options.liveCalendars ?? null);
  const language = await hostConversationLanguage(tx, hostAccountId);
  const texts = channelReplies(language).onboarding;
  const text = roles ? texts.rolesDefault(roles.calendar, roles.others) : texts.rolesNeeded;
  // Setup starts here, so the message first says what it covers (issue #368);
  // a host who saved settings before is not starting setup over.
  return (await savedSettingsOnce(tx, hostAccountId)) ? withoutSetupStep(text) : `${SETUP_OVERVIEW[language]}\n${text}`;
}

const noInput = z.object({}).strict() as unknown as z.ZodType<Record<string, never>>;

export function createImessageLinkCommand(
  options: LinkOptions,
): CommandDefinition<{ channel?: MessagingChannel; number?: string }, { linkId: string }> {
  const limits = { ...IMESSAGE_LINK_LIMITS, ...options.linkLimits };

  return {
    // iMessage unless the card asks for WhatsApp or Telegram (D6); iMessage and
    // WhatsApp need the host's number first (imessage-number-registration D1,
    // guest-whatsapp-link D3), Telegram takes none.
    input: z.union([
      z.object({ channel: z.enum(["imessage", "whatsapp"]).optional(), number: NUMBER_INPUT }).strict(),
      z.object({ channel: z.literal("telegram") }).strict(),
    ]),
    operation: "imessage.link.create",
    async run(tx, context) {
      const hostAccountId = assertSelf(context);
      const channel = context.input.channel ?? "imessage";
      if (!linkChannels(options)[channel]) throw new CommandError("unavailable_configuration");
      await lockHostLinking(tx, hostAccountId);

      const [recent] = await tx<{ count: number }[]>`
        select count(*)::int as count from app.imessage_links
        where host_account_id = ${hostAccountId} and method = 'code' and created_at > now() - interval '1 hour'
      `;
      if (recent!.count >= limits.perHostHour) throw new CommandError("rate_limited");

      const lineNumber = await attemptLineNumber(options.registrar, channel, context.input.number ?? "");

      await endOpenAttempts(tx, hostAccountId, "voided");

      const code = generateLinkCode();
      const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      const sealed = sealToken(options.tokenKey, code, codeContext(row!.id));
      await tx`
        insert into app.imessage_links (id, channel, host_account_id, method, code_hash, code_ciphertext, sealed_key_id, line_number, expires_at)
        values (${row!.id}, ${channel}, ${hostAccountId}, 'code', ${hashLinkCode(code)}, ${sealed.ciphertext}, ${sealed.keyId}, ${lineNumber},
                now() + make_interval(mins => ${limits.validMinutes}))
      `;
      return { linkId: row!.id };
    },
  };
}

// A code from the iMessage start that arrived before sign-in, now claimed by the
// host who signed in in its browser or from Thyme's sign-in link (D15, D19):
// its recorded sender is bound as an arriving code's would be (link-on-code
// D3). A sender another host holds meanwhile voids the attempt instead. The
// caller holds the host's link lock and the attempt's starter lock. Returns the
// binding, "voided", or null when no sender had arrived yet.
export async function bindReceivedAttempt(tx: Transaction, options: BindOptions, hostAccountId: string, linkId: string) {
  const [link] = await tx<
    {
      id: string;
      channel: MessagingChannel;
      sender_hash: string | null;
      sender_ciphertext: string | null;
      sender_name_ciphertext: string | null;
      space_ciphertext: string | null;
      sender_key_id: string | null;
    }[]
  >`
    select id, channel, sender_hash, sender_ciphertext, sender_name_ciphertext, space_ciphertext, sender_key_id
    from app.imessage_links
    where id = ${linkId} and host_account_id = ${hostAccountId} and state = 'received' and confirm_by > now()
    for update
  `;
  if (!link?.sender_hash || !link.sender_ciphertext || !link.sender_key_id) return null;

  const owner = await activeBindingOfSender(tx, link.sender_hash);
  if (owner && owner.host_account_id !== hostAccountId) {
    await voidAttempt(tx, link.id);
    return "voided" as const;
  }
  const open = (ciphertext: string) => openToken(options.tokenKeys, { ciphertext, keyId: link.sender_key_id! }, senderContext(link.id));
  return bind(
    tx,
    options,
    hostAccountId,
    link.id,
    open(link.sender_ciphertext),
    link.space_ciphertext ? open(link.space_ciphertext) : null,
    link.channel,
    link.sender_name_ciphertext ? open(link.sender_name_ciphertext) : null,
  );
}

async function voidAttempt(tx: Transaction, linkId: string) {
  await tx`
    update app.imessage_links
    set state = 'voided', ended_at = now(), code_ciphertext = null, sender_ciphertext = null, space_ciphertext = null
    where id = ${linkId} and state in ('pending', 'received')
  `;
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

      // A number another host has linked gets nothing; the send is recorded as
      // suppressed, so it counts toward the limits and the card shows it sent,
      // as for any number, and cannot tell who uses this product.
      const senderHash = imessageHash(options.tokenKey, "sender", number);
      const owner = await activeBindingOfSender(tx, senderHash);
      const foreign = Boolean(owner && owner.host_account_id !== hostAccountId);

      await recordOutbound(tx, {
        dedupeKey: `link:${linkId}:send:${sent!.sends}`,
        hostAccountId,
        kind: "fallback_code",
        linkId,
        recipient: { address: number, spaceId: null },
        recipientHash: senderHash,
        text: LINK_TEXTS.fallbackCode(code, limits.validMinutes),
        tokenKey: options.tokenKey,
        ...(foreign ? { suppressedAs: FOREIGN_BINDING } : {}),
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
    await tx`set local lock_timeout = '5s'`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_link:${hostAccountId}`}, 0))`;
    const ended = await tx<{ id: string }[]>`
      update app.imessage_bindings set state = 'unlinked', ended_at = now(), sender_ciphertext = null, space_ciphertext = null
      where host_account_id = ${hostAccountId} and state = 'active'
      returning id
    `;
    await endOpenAttempts(tx, hostAccountId, "cancelled");
    // Undispatched host-private messages go no further.
    await suppressQueued(tx, ended.map((binding) => binding.id), "unlinked");
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
      // WhatsApp shows the business's verified name, so it has no contact card (D11).
      if (!binding || binding.channel !== "imessage") throw new CommandError("invalid_input");

      const cards = await tx<{ state: string }[]>`
        select state from app.imessage_outbox where binding_id = ${binding.id} and kind = 'contact_card' order by created_at desc
      `;
      // No resend while one is on its way or may have arrived.
      if (cards[0] && ["queued", "dispatching", "uncertain"].includes(cards[0].state)) throw new CommandError("rate_limited");

      const { id } = await recordOutbound(tx, {
        bindingId: binding.id,
        dedupeKey: `binding:${binding.id}:card:${context.retryKey}`,
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
    "imessage.link.create": createImessageLinkCommand(options),
    "imessage.link.send_code": sendImessageCodeCommand(options),
    "imessage.link.verify_code": verifyImessageCodeCommand(options),
    "imessage.unlink": unlinkImessageCommand,
  } as unknown as Readonly<Record<string, CommandDefinition<unknown, unknown>>>;
}

// ---------------------------------------------------------------------------
// The card's status

export function deliveryState(state: string): ImessageDeliveryState {
  if (state === "accepted") return "sent";
  if (state === "failed" || state === "suppressed") return "failed";
  if (state === "uncertain") return "uncertain";
  return "queued";
}

export async function readImessageStatus(
  db: Queryable,
  keys: readonly TokenKey[],
  hostAccountId: string,
  channels: LinkChannels,
  limits: typeof IMESSAGE_FALLBACK_LIMITS = IMESSAGE_FALLBACK_LIMITS,
): Promise<ImessageStatus> {
  if (configuredChannels(channels).length === 0) return { state: "unavailable" };

  const binding = await activeBindingOfHost(db, hostAccountId);

  // An open attempt shows first, also while a sender is linked: its code arriving
  // moves the link to the new sender.
  const open = await openAttemptStatus(db, keys, hostAccountId, channels, limits);
  if (open) return open;

  if (binding) {
    let sender = binding.channel === "telegram" ? telegramDisplayName(null, null) : "••••";
    try {
      // The last four digits, the Apple ID or the Telegram name (link-on-code D4).
      sender = shownSender(keys, binding, bindingContext(binding.id), bindingRecipient(keys, binding).address, maskedSender);
    } catch {
      // Sealed under a key the service no longer holds: still linked.
    }
    // A WhatsApp message the window or Meta stopped counts as a failed delivery (design 7).
    const [latest] = await db<{ state: string; updated_at: Date; failure_category: string | null }[]>`
      select state, updated_at, failure_category from app.imessage_outbox
      where binding_id = ${binding.id} and kind not in ('contact_card', 'signal')
        and (state in ('accepted', 'failed', 'uncertain') or failure_category in ('window_closed', 'template_unavailable'))
      order by updated_at desc limit 1
    `;
    const [card] = await db<{ state: string }[]>`
      select state from app.imessage_outbox where binding_id = ${binding.id} and kind = 'contact_card' order by created_at desc limit 1
    `;
    return {
      channel: binding.channel,
      channels,
      contactCard: card ? { state: deliveryState(card.state) } : null,
      delivery:
        latest && latest.state !== "accepted"
          ? {
              at: latest.updated_at.toISOString(),
              reason:
                latest.failure_category === "window_closed" || latest.failure_category === "template_unavailable" ? latest.failure_category : null,
              state: latest.state === "uncertain" ? "uncertain" : "failed",
            }
          : null,
      lineNumber: numberOf(channels, binding.channel),
      linkedAt: binding.linked_at.toISOString(),
      sender,
      state: "linked",
    };
  }

  return { channels, lineNumber: channels.imessage ?? "", state: "none" };
}

async function openAttemptStatus(
  db: Queryable,
  keys: readonly TokenKey[],
  hostAccountId: string,
  channels: LinkChannels,
  limits: typeof IMESSAGE_FALLBACK_LIMITS,
): Promise<ImessageStatus | null> {
  const [link] = await db<
    {
      id: string;
      channel: MessagingChannel;
      method: "code" | "fallback";
      code_ciphertext: string | null;
      phone_ciphertext: string | null;
      sealed_key_id: string | null;
      expires_at: Date;
      fallback_expires_at: Date | null;
      last_sent_at: Date | null;
      sends: number;
      line_number: string | null;
    }[]
  >`
    select id, channel, method, code_ciphertext, phone_ciphertext, sealed_key_id, expires_at, fallback_expires_at, last_sent_at, sends,
           line_number
    from app.imessage_links
    where host_account_id = ${hostAccountId} and state = 'pending' and expires_at > now()
  `;

  if (!link) return null;
  // The number Photon assigned when the attempt registered the host (imessage-number-registration design 2).
  const lineNumber = link.line_number ?? numberOf(channels, link.channel);
  const shared = { channel: link.channel, channels, lineNumber };

  try {
    if (link.method === "code") {
      const code = openToken(keys, { ciphertext: link.code_ciphertext!, keyId: link.sealed_key_id! }, codeContext(link.id));
      return { ...shared, code, expiresAt: link.expires_at.toISOString(), message: attemptMessage(link.channel, code), state: "pending" };
    }

    const number = openToken(keys, { ciphertext: link.phone_ciphertext!, keyId: link.sealed_key_id! }, codeContext(link.id));
    const [send] = await db<{ state: string; failure_category: string | null }[]>`
      select state, failure_category from app.imessage_outbox where link_id = ${link.id} and kind = 'fallback_code' order by created_at desc limit 1
    `;
    const sendsLeft = Math.max(limits.sendsPerAttempt - link.sends, 0);
    return {
      channel: "imessage",
      channels,
      expiresAt: link.fallback_expires_at?.toISOString() ?? null,
      lineNumber,
      number: displaySender(number),
      resendAt:
        sendsLeft > 0 && link.last_sent_at ? new Date(link.last_sent_at.getTime() + limits.spacingSeconds * 1000).toISOString() : null,
      send: send?.failure_category === FOREIGN_BINDING ? "sent" : deliveryState(send?.state ?? "queued"),
      sendsLeft,
      state: "fallback",
    };
  } catch {
    // Sealed under a key the service no longer holds: start again.
    return null;
  }
}

// The message an attempt asks the host to send: the link message, or for
// Telegram the bare code, which the telegram.me start link carries (design 6).
export function attemptMessage(channel: MessagingChannel, code: string) {
  return channel === "telegram" ? code : linkMessage(code);
}

// A sender as a screen shows it: a Telegram sender by their sealed name, any
// other as display shows it (in full by default, masked once linked).
export function shownSender(
  keys: readonly TokenKey[],
  row: { readonly channel: MessagingChannel; readonly sender_name_ciphertext: string | null; readonly sealed_key_id: string },
  context: string,
  sender: string,
  display: (sender: string) => string = displaySender,
) {
  if (row.channel !== "telegram") return display(sender);
  const name = row.sender_name_ciphertext ? openToken(keys, { ciphertext: row.sender_name_ciphertext, keyId: row.sealed_key_id }, context) : null;
  return name ?? telegramDisplayName(null, null);
}

// ---------------------------------------------------------------------------
// The receipt job's side

export type LinkArrival = {
  readonly channel: MessagingChannel;
  readonly receiptId: string;
  readonly code: string;
  readonly sender: string;
  readonly senderHash: string;
  readonly spaceId: string;
  readonly spaceType: "dm" | "group";
  // A Telegram sender's display name (design 3), sealed with the binding.
  readonly senderName?: string | null;
};

export type LinkArrivalOutcome = "link_received" | "link_refused";

// What an arriving code needs to bind its sender. The receipt job reads a host's
// live calendar list first (arrivalOptions in imessage-receipts.ts), so the link
// can save the default calendar roles and the welcome name them.
export type ArrivalOptions = Pick<LinkOptions, "tokenKey" | "tokenKeys" | "linkLimits" | "origin" | "liveCalendars">;

// One fixed refusal per sender per day, whether for a bad code or an unlinked
// sender, and at most LINE_REFUSALS_PER_DAY per line, counted per channel.
export async function refusalSentRecently(q: Queryable, recipientHash: string, channel: MessagingChannel = "imessage") {
  const [row] = await q<{ sender: boolean; line: number }[]>`
    select bool_or(recipient_hash = ${recipientHash}) as sender, count(*)::int as line from app.imessage_outbox
    where kind in ('link_refused', 'unlinked_sender') and channel = ${channel} and created_at > now() - interval '24 hours'
  `;
  return Boolean(row?.sender) || (row?.line ?? 0) >= LINE_REFUSALS_PER_DAY;
}

// A message carrying a link code (link-on-code D1). A pending, unexpired code
// from a direct conversation on the attempt's channel, from a sender no other
// host has linked, links that sender at once:
//   - a host's attempt binds the sender to the host and queues the linked
//     message, which is the welcome into setup for a host still setting up;
//   - a guest's attempt (guest-flow-completion design 1) binds the sender to the
//     open request and queues the guest's welcome; any sender may link a guest
//     request, a host included, since a guest binding is separate;
//   - an attempt from the iMessage start has no host yet (D15): the sender is
//     recorded, Thyme replies with the sign-in link (D19), and the browser's
//     Google sign-in binds it (bindReceivedAttempt).
// Anything else (a used, voided or expired code, another channel, a group, a
// sender another host holds, a host who is no longer active, a closed request)
// voids the attempt the code names and gets at most one refusal a day. The
// code's message is never forwarded.
// Lock order, as the commands that change the same rows take it: a host's
// account share lock before the host's link lock; a request's row before its
// link lock; a start's starter lock alone.
export async function receiveLinkCode(tx: Transaction, options: ArrivalOptions, arrival: LinkArrival): Promise<LinkArrivalOutcome> {
  const limits = { ...IMESSAGE_LINK_LIMITS, ...options.linkLimits };
  const [named] = await tx<{ host_account_id: string | null; request_id: string | null; starter_hash: string | null }[]>`
    select host_account_id, request_id, starter_hash from app.imessage_links where code_hash = ${hashLinkCode(arrival.code)}
  `;

  if (named) {
    let ownerOpen = await lockArrivalOwner(tx, named);
    // A start's attempt a sign-in claimed while this waited for its lock now has
    // a host, whose locks come before the attempt's row, as in every command.
    if (!named.host_account_id && !named.request_id) {
      const [claimed] = await tx<{ host_account_id: string | null }[]>`
        select host_account_id from app.imessage_links where code_hash = ${hashLinkCode(arrival.code)}
      `;
      if (claimed?.host_account_id) ownerOpen = await lockArrivalOwner(tx, { ...named, host_account_id: claimed.host_account_id });
    }
    const [link] = await tx<
      {
        id: string;
        channel: MessagingChannel;
        host_account_id: string | null;
        request_id: string | null;
        starter_hash: string | null;
        state: string;
        live: boolean;
        received_by_receipt_id: string | null;
        sender_hash: string | null;
      }[]
    >`
      select id, channel, host_account_id, request_id, starter_hash, state, expires_at > now() as live, received_by_receipt_id, sender_hash
      from app.imessage_links where code_hash = ${hashLinkCode(arrival.code)}
      for update
    `;

    // A retried job finds what this message already did, and the same sender
    // sending the code again (a double tap) changes nothing.
    if (link?.received_by_receipt_id === arrival.receiptId) return "link_received";
    if ((link?.state === "received" || link?.state === "linked") && link.sender_hash === arrival.senderHash) return "link_received";

    const owner = link?.host_account_id ? await activeBindingOfSender(tx, arrival.senderHash) : null;
    // Only the channel the attempt was made for completes it (D6).
    const usable =
      ownerOpen &&
      link?.state === "pending" &&
      link.live &&
      link.channel === arrival.channel &&
      arrival.spaceType === "dm" &&
      (!owner || owner.host_account_id === link.host_account_id);

    if (usable) {
      // The arrival is recorded on the attempt first: the binding's WhatsApp
      // window starts at this message (design 7).
      await tx`
        update app.imessage_links set sender_hash = ${arrival.senderHash}, received_by_receipt_id = ${arrival.receiptId}
        where id = ${link.id}
      `;
      if (link.host_account_id) {
        try {
          await bind(tx, options, link.host_account_id, link.id, arrival.sender, arrival.spaceId, link.channel, arrival.senderName ?? null);
        } catch (error) {
          // Another host linked this sender between the check above and the
          // sender's lock: refused like any held sender, not a failed job.
          if (!(error instanceof SenderHeldError)) throw error;
          await voidAttempt(tx, link.id);
          return refuse(tx, options, arrival);
        }
        // bind's bounded lock wait is for the binding rows only.
        await tx`set local lock_timeout to default`;
        return "link_received";
      }
      if (link.request_id) {
        await bindGuest(tx, options.tokenKey, link.request_id, link.id, arrival);
        return "link_received";
      }

      const context = senderContext(link.id);
      const sender = sealToken(options.tokenKey, arrival.sender, context);
      const space = sealToken(options.tokenKey, arrival.spaceId, context);
      const name = arrival.senderName ? sealToken(options.tokenKey, arrival.senderName, context) : null;
      await tx`
        update app.imessage_links
        set state = 'received', sender_ciphertext = ${sender.ciphertext}, sender_name_ciphertext = ${name?.ciphertext ?? null},
            space_ciphertext = ${space.ciphertext}, sender_key_id = ${options.tokenKey.id}, code_ciphertext = null,
            confirm_by = now() + make_interval(mins => ${limits.confirmMinutes})
        where id = ${link.id}
      `;
      // Telegram gets no reply here: the bot's first message is the welcome
      // once the sign-in links it (design 6).
      if (arrival.channel === "telegram") return "link_received";
      await recordOutbound(tx, {
        channel: arrival.channel,
        dedupeKey: `receipt:${arrival.receiptId}`,
        hostAccountId: null,
        kind: "link_received",
        linkId: link.id,
        recipient: { address: arrival.sender, spaceId: arrival.spaceId },
        recipientHash: arrival.senderHash,
        requestId: null,
        text: LINK_TEXTS.receivedBeforeSignIn(imessageContinuationUrl(options.origin, options.tokenKey, link.id, arrival.senderHash)),
        tokenKey: options.tokenKey,
      });
      return "link_received";
    }

    if (link) await voidAttempt(tx, link.id);
  }
  return refuse(tx, options, arrival);
}

// At most one fixed refusal a day per sender, and never into a group.
async function refuse(tx: Transaction, options: ArrivalOptions, arrival: LinkArrival): Promise<LinkArrivalOutcome> {
  if (arrival.spaceType === "dm" && !(await refusalSentRecently(tx, arrival.senderHash, arrival.channel))) {
    await recordOutbound(tx, {
      channel: arrival.channel,
      dedupeKey: `receipt:${arrival.receiptId}`,
      kind: "link_refused",
      recipient: { address: arrival.sender, spaceId: arrival.spaceId },
      recipientHash: arrival.senderHash,
      text: refusedText(arrival.channel),
      tokenKey: options.tokenKey,
    });
  }
  return "link_refused";
}

// Takes the locks an arriving code's attempt needs, in the commands' order, and
// says whether its owner can still link: an active host, an open request, or a
// start (which has no owner yet).
async function lockArrivalOwner(
  tx: Transaction,
  owner: { readonly host_account_id: string | null; readonly request_id: string | null; readonly starter_hash: string | null },
) {
  let open = true;
  try {
    if (owner.host_account_id) await lockActiveHost(tx, owner.host_account_id);
    else if (owner.request_id) await lockOpenRequest(tx, owner.request_id);
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    open = false;
  }
  await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey(owner)}, 0))`;
  return open;
}

// Binds an arriving sender to the guest's request (guest-flow-completion design
// 2) and ends the attempt; bindRequester queues the welcome.
async function bindGuest(tx: Transaction, tokenKey: TokenKey, requestId: string, linkId: string, arrival: LinkArrival) {
  const [host] = await tx<{ display_name: string | null }[]>`
    select s.settings ->> 'displayName' as display_name
    from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${requestId}
  `;
  const bindingId = await bindRequester(tx, tokenKey, {
    channel: arrival.channel,
    hostName: host?.display_name ?? "your host",
    linkId,
    requestId,
    sender: arrival.sender,
    senderHash: arrival.senderHash,
    senderName: arrival.senderName ?? null,
    spaceId: arrival.spaceId,
  });
  await tx`
    update app.imessage_links
    set state = 'linked', binding_id = ${bindingId}, ended_at = now(), code_ciphertext = null,
        sender_ciphertext = null, space_ciphertext = null
    where id = ${linkId}
  `;
  return bindingId;
}

// A Google sign-in started from Thyme's Calendar link (D19) tells the linked
// conversation to carry on, through the outbox like every other reply. The
// redeemed authorization code keys it, so a replayed callback queues nothing
// twice; it does not claim that Calendar was granted.
export async function resumeImessageOnboarding(db: Database, key: TokenKey, hostAccountId: string, authCode: string, calendar: Omit<GoogleCalendarDependencies, "db"> = { config: googleCalendarConfigFromEnvironment(), tokenKeys: [key] }) {
  const live = await readDefaultRoleCalendars(db, hostAccountId, calendar);
  await db.begin(async (tx) => {
    await lockHostLinking(tx, hostAccountId);
    const binding = await activeBindingOfHost(tx, hostAccountId);
    if (!binding) return;
    const dedupeKey = `google-return:${createHmac("sha256", key.key).update(`imessage-google-return:${authCode}`).digest("hex")}`;
    const [already] = await tx`select id from app.imessage_outbox where kind = 'command' and dedupe_key = ${dedupeKey}`;
    if (already) return;
    const [grant] = await tx<{ usable: boolean }[]>`select ${calendarUsable(tx)} as usable from app.provider_grants g where g.host_account_id = ${hostAccountId}`;
    let text: string = LINK_TEXTS.backFromGoogle;
    if (grant?.usable && !(await readReadiness(tx, hostAccountId)).ready) {
      const roles = await defaultCalendarRoles(tx, hostAccountId, live);
      const texts = channelReplies(await hostConversationLanguage(tx, hostAccountId)).onboarding;
      const roleText = roles ? texts.rolesDefault(roles.calendar, roles.others) : texts.rolesNeeded;
      text = (await savedSettingsOnce(tx, hostAccountId)) ? withoutSetupStep(roleText) : roleText;
    }
    await recordOutbound(tx, {
      bindingId: binding.id,
      dedupeKey,
      hostAccountId,
      kind: "command",
      recipient: bindingRecipient([key], binding),
      recipientHash: binding.sender_hash,
      text,
      tokenKey: key,
    });
  });
}


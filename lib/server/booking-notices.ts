import type { RequestLanguage } from "../contracts/request";
import { isValidTimeZone } from "../contracts/setup";
import { type BookingEmailParameters, calendarInvitation, type MeetingParameters } from "./booking-emails";
import { bookingUrl } from "./booking-links";
import { eventTitle } from "./calendar-events";
import type { Transaction } from "./database";
import { enqueueEmail, frozenSender } from "./email-delivery";
import { openRequestBookingId } from "./request-start";
import { appOriginsFromEnvironment } from "./same-origin";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Records the booking confirmation and the requester status notifications
// (host-review-and-booking design 9, D10, D11) in the transaction of the domain
// change that needs them. Every email is frozen from domain records: the meeting
// from the proposal or the confirmed event, the recipient's language and
// timezone, the From header with the host's display name for a confirmation, and
// Reply-To the other party. The requester's booking link is opened from its
// sealed copy and sealed again as the delivery's secret parameter; the host's
// copy links to the request in /app and carries no booking link.

export type NoticeDependencies = {
  readonly origin: string;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
};

export function noticeDependenciesFromEnvironment(): NoticeDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return { origin: appOriginsFromEnvironment().appOrigin, tokenKey, tokenKeys: [tokenKey] };
}

export function hostRequestUrl(origin: string, requestId: string) {
  return `${origin.replace(/\/+$/, "")}/app?request=${requestId}`;
}

type Parties = {
  readonly hostName: string;
  readonly hostEmail: string | null;
  readonly hostTimezone: string;
  readonly requesterName: string;
  readonly requesterEmail: string;
  readonly requesterTimezone: string;
  readonly language: RequestLanguage;
  readonly purpose: string | null;
};

async function partiesOf(tx: Transaction, requestId: string): Promise<Parties | null> {
  const [row] = await tx<
    {
      contact_email: string | null;
      details: { language?: string; purpose?: string | null; timezone?: string };
      host_email: string | null;
      host_name: string | null;
      host_timezone: string | null;
      requester_name: string | null;
    }[]
  >`
    select r.requester_name, r.contact_email, r.details,
           s.settings ->> 'displayName' as host_name, s.settings ->> 'timezone' as host_timezone,
           (select email from app.google_identities g where g.host_account_id = r.host_account_id) as host_email
    from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${requestId}
  `;

  if (!row?.contact_email || !row.requester_name) return null;

  const hostTimezone = row.host_timezone && isValidTimeZone(row.host_timezone) ? row.host_timezone : "UTC";

  return {
    hostEmail: row.host_email,
    hostName: row.host_name?.trim() || "Your host",
    hostTimezone,
    language: row.details.language === "ko" ? "ko" : "en",
    purpose: row.details.purpose ?? null,
    requesterEmail: row.contact_email,
    requesterName: row.requester_name,
    requesterTimezone: row.details.timezone && isValidTimeZone(row.details.timezone) ? row.details.timezone : hostTimezone,
  };
}

type Meeting = {
  readonly start: string;
  readonly end: string;
  readonly mode: "online" | "in_person";
  readonly location: string | null;
  readonly joinUrl: string | null;
  readonly organizerName?: string | null;
  readonly organizerEmail?: string | null;
};

function meetingFor(parties: Parties, meeting: Meeting, timezone: string): MeetingParameters {
  return {
    durationMinutes: Math.round((Date.parse(meeting.end) - Date.parse(meeting.start)) / 60_000),
    end: meeting.end,
    hostEmail: parties.hostEmail,
    hostName: parties.hostName,
    joinUrl: meeting.joinUrl,
    location: meeting.location,
    mode: meeting.mode,
    organizerEmail: meeting.organizerEmail ?? null,
    organizerName: meeting.organizerName ?? null,
    requesterEmail: parties.requesterEmail,
    requesterName: parties.requesterName,
    start: meeting.start,
    timezone,
    title: eventTitle(parties.purpose, parties.requesterName),
  };
}

// The requester's booking link, opened from its sealed copy. A link sealed
// under a key the service no longer holds cannot be opened: no email is
// recorded for it, rather than failing the domain change that wanted one.
async function requesterBookingUrl(tx: Transaction, deps: NoticeDependencies, requestId: string) {
  try {
    const bookingId = await openRequestBookingId(tx, deps.tokenKeys, requestId);
    return bookingId ? bookingUrl(deps.origin, bookingId) : null;
  } catch {
    return null;
  }
}

export type ConfirmedMeeting = Meeting & {
  readonly bookingId: string;
  readonly iCalUID: string | null;
  readonly confirmedAt: string;
};

// Both copies of the confirmation, one delivery per booking and recipient.
export async function enqueueConfirmations(tx: Transaction, deps: NoticeDependencies, requestId: string, meeting: ConfirmedMeeting) {
  const parties = await partiesOf(tx, requestId);
  if (!parties) return;

  const sender = frozenSender(process.env, parties.hostName);
  const attachmentFor = (parameters: MeetingParameters) =>
    meeting.iCalUID
      ? [
          {
            content: Buffer.from(calendarInvitation({ ...parameters, stamp: meeting.confirmedAt, uid: meeting.iCalUID }), "utf8").toString("base64"),
            filename: "invite.ics",
            type: "text/calendar; method=REQUEST; charset=UTF-8",
          },
        ]
      : [];

  const requesterMeeting = meetingFor(parties, meeting, parties.requesterTimezone);
  const link = await requesterBookingUrl(tx, deps, requestId);

  if (link) {
    const parameters: BookingEmailParameters = { ...requesterMeeting, audience: "requester" };
    await enqueueEmail(tx, {
      attachments: attachmentFor(requesterMeeting),
      dedupeKey: `${meeting.bookingId}:requester`,
      from: sender,
      kind: "booking_confirmation",
      language: parties.language,
      parameters,
      recipient: parties.requesterEmail,
      replyTo: parties.hostEmail,
      requestId,
      secrets: { bookingUrl: link },
      tokenKey: deps.tokenKey,
    });
  }

  if (parties.hostEmail) {
    const hostMeeting = meetingFor(parties, meeting, parties.hostTimezone);
    const parameters: BookingEmailParameters = {
      ...hostMeeting,
      audience: "host",
      viewUrl: hostRequestUrl(deps.origin, requestId),
    };
    await enqueueEmail(tx, {
      attachments: attachmentFor(hostMeeting),
      dedupeKey: `${meeting.bookingId}:host`,
      from: sender,
      kind: "booking_confirmation",
      language: "en",
      parameters,
      recipient: parties.hostEmail,
      replyTo: parties.requesterEmail,
      requestId,
      secrets: {},
      tokenKey: deps.tokenKey,
    });
  }
}

export type StatusNotice =
  | { readonly kind: "status_new_version"; readonly version: number; readonly meeting: Meeting }
  | { readonly kind: "status_declined" }
  | { readonly kind: "status_expired" }
  | { readonly kind: "status_pending"; readonly bookingId: string; readonly meeting: Meeting };

function dedupeKeyOf(requestId: string, notice: StatusNotice) {
  switch (notice.kind) {
    case "status_new_version":
      return `${requestId}:v${notice.version}`;
    case "status_pending":
      return `${notice.bookingId}`;
    default:
      return requestId;
  }
}

// One status notice to the requester's contact address, confirmed or not (D11).
export async function enqueueStatusNotice(tx: Transaction, deps: NoticeDependencies, requestId: string, notice: StatusNotice) {
  const parties = await partiesOf(tx, requestId);
  const link = parties ? await requesterBookingUrl(tx, deps, requestId) : null;
  if (!parties || !link) return;

  const meeting =
    "meeting" in notice
      ? meetingFor(parties, notice.meeting, parties.requesterTimezone)
      : meetingFor(parties, { end: new Date(0).toISOString(), joinUrl: null, location: null, mode: "online", start: new Date(0).toISOString() }, parties.requesterTimezone);
  const parameters: BookingEmailParameters = {
    ...meeting,
    audience: "requester",
    ...(notice.kind === "status_new_version" ? { version: notice.version } : {}),
    ...(notice.kind === "status_pending" ? { bookingId: notice.bookingId } : {}),
  };

  await enqueueEmail(tx, {
    dedupeKey: dedupeKeyOf(requestId, notice),
    kind: notice.kind,
    language: parties.language,
    parameters,
    recipient: parties.requesterEmail,
    requestId,
    secrets: { bookingUrl: link },
    tokenKey: deps.tokenKey,
  });
}

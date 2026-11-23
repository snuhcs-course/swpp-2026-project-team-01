import { isValidTimeZone } from "../contracts/timezone";
import type { Queryable } from "./database";

// What the guest sent the host when they agreed to a proposal
// (guest-email-and-agree-notices design 4; issue #179). One summary, read from
// the agreed proposal version's own records, feeds every channel's notice: the
// linked iMessage, WhatsApp or Telegram text here, and the agreement email
// (#178) can render the same fields. It carries no booking link.

export type AgreementSummary = {
  readonly version: number;
  readonly hostName: string;
  readonly requesterName: string;
  readonly purpose: string | null;
  readonly start: Date;
  readonly end: Date;
  // The guest's timezone, named in the time line.
  readonly timezone: string;
  readonly durationMinutes: number;
  readonly mode: "online" | "in_person";
  // The place of an in-person meeting, or null.
  readonly location: string | null;
  // A change to a booked meeting: the booked meeting stands until the host
  // approves this version.
  readonly changesBooking: boolean;
};

// The agreed version's summary, or null when that version has no agreement or
// the request is gone.
export async function readAgreementSummary(q: Queryable, requestId: string, version: number): Promise<AgreementSummary | null> {
  const [row] = await q<
    {
      changes_booking: boolean;
      end_at: Date;
      host_name: string | null;
      location: string | null;
      mode: string | null;
      purpose: string | null;
      requester_name: string | null;
      start_at: Date;
      timezone: string | null;
    }[]
  >`
    select p.start_at, p.end_at, p.details ->> 'mode' as mode, p.details ->> 'location' as location,
           r.requester_name, r.details ->> 'purpose' as purpose, r.details ->> 'timezone' as timezone,
           s.settings ->> 'displayName' as host_name,
           exists (select 1 from app.bookings b where b.request_id = r.id and b.state = 'confirmed') as changes_booking
    from app.proposals p
    join app.requests r on r.id = p.request_id
    left join app.host_settings s on s.host_account_id = r.host_account_id
    where p.request_id = ${requestId} and p.version = ${version}
      and exists (select 1 from app.agreements a where a.proposal_id = p.id)
  `;
  if (!row) return null;

  const mode = row.mode === "in_person" ? "in_person" : "online";
  return {
    changesBooking: row.changes_booking,
    durationMinutes: Math.round((row.end_at.getTime() - row.start_at.getTime()) / 60_000),
    end: row.end_at,
    hostName: row.host_name?.trim() || "Your host",
    location: mode === "in_person" ? row.location?.trim() || null : null,
    mode,
    purpose: row.purpose?.trim() || null,
    requesterName: row.requester_name?.trim() || "You",
    start: row.start_at,
    timezone: row.timezone && isValidTimeZone(row.timezone) ? row.timezone : "UTC",
    version,
  };
}

// The date and time in the guest's timezone, with the zone named.
export function agreementWhen(summary: Pick<AgreementSummary, "start" | "end" | "timezone">) {
  const zone = summary.timezone;
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: zone, weekday: "short", year: "numeric" }).format(summary.start);
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day}, ${clock.format(summary.start)}–${clock.format(summary.end)} (${zone})`;
}

export function agreementWhere(summary: Pick<AgreementSummary, "mode" | "location">) {
  if (summary.mode === "online") return "Online";
  return summary.location ? `In person at ${summary.location}` : "In person";
}

// The fixed lines of the notice, in English (decision log "Product language").
export function agreementDetailLines(summary: AgreementSummary) {
  return [
    `People: ${summary.hostName} and ${summary.requesterName}`,
    ...(summary.purpose ? [`Purpose: ${summary.purpose}`] : []),
    `When: ${agreementWhen(summary)}`,
    `Length: ${summary.durationMinutes} minutes`,
    `Where: ${agreementWhere(summary)}`,
  ];
}

// The chat text: what was sent, that it waits for the host's approval and is
// not booked (or, for a change, that the booked meeting stands), without a link.
export function agreementNoticeText(summary: AgreementSummary) {
  const status = summary.changesBooking
    ? `It is waiting for ${summary.hostName}'s approval. Your booked meeting stays as it is until then.`
    : `It is waiting for ${summary.hostName}'s approval and is not booked yet.`;
  return [
    `You sent this to ${summary.hostName}:`,
    ...agreementDetailLines(summary).map((line) => `- ${line}`),
    status,
    "I'll tell you here when they decide.",
  ].join("\n");
}

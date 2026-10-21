import type { Queryable } from "./database";
import { deploymentEnvironment } from "./deployment";
import {
  type CalendarEvent,
  createGoogleCalendarClient,
  GOOGLE_CALENDAR_API_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_REQUEST_TIMEOUT_MS,
  type GoogleCalendarConfig,
} from "./google-calendar";
import { openToken, type TokenKey } from "./token-encryption";

// A requester's Google Calendar, read only inside an evaluation of its own request
// (requester-calendar-access: private read-only Calendar access). The refresh
// token is the request's live calendar grant, sealed under requester_grant:{id},
// and is exchanged with the requester OAuth client (the host sign-in client unless
// GOOGLE_REQUESTER_CLIENT_ID/SECRET name another).
// Event contents stay in the evaluation's memory: the caller derives busy
// intervals and adjacent places and stores neither.

export const REQUESTER_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

const EVENTS_SCOPE = REQUESTER_CALENDAR_SCOPES[1];

type Environment = Readonly<Record<string, string | undefined>>;

// GOOGLE_REQUESTER_CLIENT_ID/SECRET, falling back to GOOGLE_CLIENT_ID/SECRET, and
// the same stand-in variables as the host client: GOOGLE_OAUTH_TOKEN_URL and
// GOOGLE_CALENDAR_API_URL, ignored on production.
export function requesterCalendarConfigFromEnvironment(env: Environment = process.env): GoogleCalendarConfig {
  const overridable = deploymentEnvironment(env) !== "production";

  return {
    apiBaseUrl: (overridable && env.GOOGLE_CALENDAR_API_URL?.trim()) || GOOGLE_CALENDAR_API_URL,
    clientId: (env.GOOGLE_REQUESTER_CLIENT_ID?.trim() || env.GOOGLE_CLIENT_ID?.trim()) ?? "",
    clientSecret: (env.GOOGLE_REQUESTER_CLIENT_SECRET?.trim() || env.GOOGLE_CLIENT_SECRET?.trim()) ?? "",
    timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS,
    tokenUrl: (overridable && env.GOOGLE_OAUTH_TOKEN_URL?.trim()) || GOOGLE_OAUTH_TOKEN_URL,
  };
}

export function requesterGrantContext(requestId: string) {
  return `requester_grant:${requestId}`;
}

export type RequesterCalendarGrant = {
  readonly calendarIds: readonly string[];
  readonly email: string | null;
  readonly refreshToken: string;
};

// The request's own live calendar grant, or null when the requester connected no
// calendar. Only this request's row is ever read, so another request's grant of
// the same Google identity is never consulted.
export async function readRequesterCalendarGrant(
  db: Queryable,
  keys: readonly TokenKey[],
  requestId: string,
): Promise<RequesterCalendarGrant | null> {
  const [row] = await db<
    {
      calendar_ids: string[];
      google_email: string | null;
      granted_scopes: string[];
      refresh_token_ciphertext: string | null;
      refresh_token_key_id: string | null;
    }[]
  >`
    select calendar_ids, google_email, granted_scopes, refresh_token_ciphertext, refresh_token_key_id
    from app.requester_grants
    where request_id = ${requestId} and kind = 'calendar' and revoked_at is null
  `;

  if (!row) return null;

  if (!row.refresh_token_ciphertext || !row.refresh_token_key_id || !row.granted_scopes.includes(EVENTS_SCOPE)) {
    throw new RequesterCalendarUnavailableError();
  }

  return {
    calendarIds: row.calendar_ids.length > 0 ? row.calendar_ids : ["primary"],
    email: row.google_email,
    refreshToken: openToken(
      keys,
      { ciphertext: row.refresh_token_ciphertext, keyId: row.refresh_token_key_id },
      requesterGrantContext(requestId),
    ),
  };
}

// A grant that exists but cannot be read: revoked at Google, failing, or missing
// its events scope. The evaluation pauses on it rather than reading free time.
export class RequesterCalendarUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The requester's calendar could not be read.", options);
    this.name = "RequesterCalendarUnavailableError";
  }
}

// Every event on the grant's selected calendars in the range. Any failure,
// including Google rejecting the token, throws RequesterCalendarUnavailableError;
// a cancelled signal rejects with its own reason, so the caller's deadline decides.
// Closing the grant is the grant lifecycle's job (Disconnect, closure), not this.
export async function readRequesterEvents(
  config: GoogleCalendarConfig,
  grant: RequesterCalendarGrant,
  range: { readonly start: Date; readonly end: Date },
  options: { readonly signal?: AbortSignal } = {},
): Promise<CalendarEvent[]> {
  const client = createGoogleCalendarClient(config, grant.refreshToken, async () => {});
  const events: CalendarEvent[] = [];

  for (const calendarId of grant.calendarIds) {
    options.signal?.throwIfAborted();

    try {
      events.push(...(await client.listEvents(calendarId, range, options)));
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      throw new RequesterCalendarUnavailableError({ cause: error });
    }
  }

  return events;
}

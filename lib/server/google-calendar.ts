import { GOOGLE_CALENDAR_SCOPES } from "../contracts/google-scopes";
import type { CalendarRef } from "../contracts/setup";
import type { Queryable } from "./database";
import { deploymentEnvironment } from "./deployment";
import { markGoogleGrantInvalid, readGoogleGrant } from "./provider-grants";
import type { TokenKey } from "./token-encryption";

// The host's Google Calendar, read by domain code from the stored grant (never an
// agent tool), after OpenInstinct's google-workspace client: a user-scoped client,
// minimal `fields`, and provider failures mapped to a few categories. It exchanges
// the sealed refresh token for an access token, then reads calendarList.list and
// events.list with a timeout per request and a page cap. A list still unfinished
// at its cap is reported as unavailable, never returned truncated: a partial event
// list would read as free time. Tokens are never logged. The same client reads a
// requester's calendars from their own grant (requester-calendar.ts).

export type CalendarAccessCategory = "calendar_not_connected" | "calendar_access_revoked" | "calendar_unavailable";

const CALENDAR_ACCESS_MESSAGES: Readonly<Record<CalendarAccessCategory, string>> = {
  calendar_not_connected: "Google Calendar is not connected.",
  calendar_access_revoked: "Google Calendar access was revoked.",
  calendar_unavailable: "Google Calendar could not be read right now.",
};

export class CalendarAccessError extends Error {
  readonly category: CalendarAccessCategory;

  constructor(category: CalendarAccessCategory, options?: { cause?: unknown }) {
    super(CALENDAR_ACCESS_MESSAGES[category], options);
    this.name = "CalendarAccessError";
    this.category = category;
  }
}

export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;

const PAGE_SIZE = 250;
const MAX_EVENT_PAGES = 8;
const MAX_CALENDAR_PAGES = 10;

// What reading calendars and events needs; calendar.events.freebusy is not enough.
const REQUIRED_SCOPES = [GOOGLE_CALENDAR_SCOPES[0], GOOGLE_CALENDAR_SCOPES[1]];

export type GoogleCalendarConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenUrl: string;
  readonly apiBaseUrl: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
};

type Environment = Readonly<Record<string, string | undefined>>;

// GOOGLE_OAUTH_TOKEN_URL and GOOGLE_CALENDAR_API_URL point tests and local runs at
// a fake Google; production always talks to Google itself. Missing client
// credentials surface as calendar_unavailable when the client is used.
export function googleCalendarConfigFromEnvironment(env: Environment = process.env): GoogleCalendarConfig {
  const overridable = deploymentEnvironment(env) !== "production";

  return {
    apiBaseUrl: (overridable && env.GOOGLE_CALENDAR_API_URL?.trim()) || GOOGLE_CALENDAR_API_URL,
    clientId: env.GOOGLE_CLIENT_ID?.trim() ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
    timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS,
    tokenUrl: (overridable && env.GOOGLE_OAUTH_TOKEN_URL?.trim()) || GOOGLE_OAUTH_TOKEN_URL,
  };
}

export type CalendarListEntry = CalendarRef & { readonly timeZone: string | null };

type EventTime = { readonly dateTime?: string; readonly date?: string; readonly timeZone?: string };

// One event as analysis reads it. Attendee addresses stay in memory: evidence
// stores only counts derived from them.
export type CalendarEvent = {
  readonly id: string;
  readonly calendarId: string;
  readonly status: string;
  readonly summary: string | null;
  readonly start: EventTime;
  readonly end: EventTime;
  readonly transparency: string | null;
  readonly location: string | null;
  readonly hasConferenceLink: boolean;
  readonly attendees: readonly { readonly email: string; readonly self: boolean; readonly responseStatus: string | null }[];
  readonly updated: string | null;
  readonly recurringEventId: string | null;
  readonly iCalUID: string | null;
};

export type HostCalendar = {
  listCalendars(options?: {
    readonly signal?: AbortSignal;
  }): Promise<{ calendars: CalendarListEntry[]; primaryTimeZone: string | null }>;
  listEvents(
    calendarId: string,
    range: { readonly start: Date; readonly end: Date },
    options?: { readonly signal?: AbortSignal },
  ): Promise<CalendarEvent[]>;
  // One calendar list entry's allowed conference solution types (design decision
  // 11: hangoutsMeet means Google Meet can be created with the event).
  conferenceSolutionTypes(calendarId: string, options?: { readonly signal?: AbortSignal }): Promise<string[]>;
};

export type GoogleCalendarDependencies = {
  readonly db: Queryable;
  readonly tokenKeys: readonly TokenKey[];
  readonly config: GoogleCalendarConfig;
};

type RawCalendarListEntry = {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  accessRole?: string;
  primary?: boolean;
  timeZone?: string;
};

type RawEvent = {
  id?: string;
  status?: string;
  summary?: string;
  start?: EventTime;
  end?: EventTime;
  transparency?: string;
  location?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { email?: string; self?: boolean; responseStatus?: string; resource?: boolean }[];
  updated?: string;
  recurringEventId?: string;
  iCalUID?: string;
};

const CALENDAR_LIST_FIELDS = "nextPageToken,items(id,summary,summaryOverride,accessRole,primary,timeZone)";
const EVENT_FIELDS =
  "nextPageToken,items(id,status,summary,start,end,transparency,location,hangoutLink," +
  "conferenceData(entryPoints(entryPointType)),attendees(email,self,responseStatus,resource)," +
  "updated,recurringEventId,iCalUID)";

// A location that is a meeting URL is a conference link, not a place.
const MEETING_URL = /https?:\/\/|meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com/i;

function toEvent(calendarId: string, raw: RawEvent): CalendarEvent | null {
  if (!raw.id || !raw.start || !raw.end) return null;

  const location = raw.location?.trim() || null;
  const hasConferenceLink =
    Boolean(raw.hangoutLink) ||
    Boolean(raw.conferenceData?.entryPoints?.some((entry) => entry.entryPointType === "video")) ||
    (location !== null && MEETING_URL.test(location));

  return {
    attendees: (raw.attendees ?? [])
      .filter((attendee) => attendee.email && !attendee.resource)
      .map((attendee) => ({
        email: attendee.email!,
        responseStatus: attendee.responseStatus ?? null,
        self: attendee.self === true,
      })),
    calendarId,
    end: raw.end,
    hasConferenceLink,
    iCalUID: raw.iCalUID ?? null,
    id: raw.id,
    location,
    recurringEventId: raw.recurringEventId ?? null,
    start: raw.start,
    status: raw.status ?? "confirmed",
    summary: raw.summary ?? null,
    transparency: raw.transparency ?? null,
    updated: raw.updated ?? null,
  };
}

async function readGrantState(db: Queryable, hostAccountId: string) {
  const [row] = await db<{ granted_scopes: string[]; invalidated: boolean }[]>`
    select granted_scopes, invalidated_at is not null as invalidated
    from app.provider_grants
    where host_account_id = ${hostAccountId}
  `;
  return row ?? null;
}

// Opens the host's calendar from the stored grant. It refuses with
// calendar_not_connected when there is no usable grant: no refresh token, an
// invalidated one, or the reading scopes not granted. The access token is fetched
// on first use and reused until it expires.
export async function openHostCalendar(deps: GoogleCalendarDependencies, hostAccountId: string): Promise<HostCalendar> {
  const state = await readGrantState(deps.db, hostAccountId);

  if (!state || state.invalidated || !REQUIRED_SCOPES.every((scope) => state.granted_scopes.includes(scope))) {
    throw new CalendarAccessError("calendar_not_connected");
  }

  const grant = await readGoogleGrant(deps.db, deps.tokenKeys, hostAccountId);

  if (!grant?.refreshToken) {
    throw new CalendarAccessError("calendar_not_connected");
  }

  return createGoogleCalendarClient(deps.config, grant.refreshToken, () => markGoogleGrantInvalid(deps.db, hostAccountId));
}

// A Calendar client over one refresh token. onInvalidGrant runs when Google
// rejects the token (invalid_grant), before calendar_access_revoked is thrown, so
// the caller can record that its grant is no longer usable.
export function createGoogleCalendarClient(
  config: GoogleCalendarConfig,
  refreshToken: string,
  onInvalidGrant: () => Promise<unknown>,
): HostCalendar {
  const fetcher = config.fetch ?? fetch;
  let access: { token: string; expiresAt: number } | null = null;

  async function send(url: string, init: RequestInit, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(config.timeoutMs);

    try {
      return await fetcher(url, { ...init, signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
    } catch (error) {
      throw new CalendarAccessError("calendar_unavailable", { cause: error });
    }
  }

  async function accessToken(signal?: AbortSignal) {
    if (access && access.expiresAt > Date.now()) return access.token;

    if (!config.clientId || !config.clientSecret) {
      throw new CalendarAccessError("calendar_unavailable");
    }

    const response = await send(
      config.tokenUrl,
      {
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        method: "POST",
      },
      signal,
    );
    const body = (await response.json().catch(() => null)) as
      | { access_token?: string; error?: string; expires_in?: number }
      | null;

    if (response.ok && body?.access_token) {
      // Refreshed a minute early, so a token never expires mid-request.
      access = { expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000, token: body.access_token };
      return access.token;
    }

    if (body?.error === "invalid_grant") {
      await onInvalidGrant();
      throw new CalendarAccessError("calendar_access_revoked");
    }

    throw new CalendarAccessError("calendar_unavailable");
  }

  async function getJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const url = `${config.apiBaseUrl}${path}?${new URLSearchParams(params)}`;

    for (let attempt = 0; ; attempt += 1) {
      const token = await accessToken(signal);
      const response = await send(url, { headers: { authorization: `Bearer ${token}` } }, signal);

      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch (error) {
          throw new CalendarAccessError("calendar_unavailable", { cause: error });
        }
      }

      // An access token Google stopped accepting is refreshed once; a revoked grant
      // is reported by that refresh (invalid_grant), which also invalidates it, so
      // calendar_access_revoked always means the grant is marked invalid.
      if (response.status === 401 && attempt === 0) {
        access = null;
        continue;
      }

      throw new CalendarAccessError("calendar_unavailable");
    }
  }

  return {
    async listCalendars(options) {
      const calendars: CalendarListEntry[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < MAX_CALENDAR_PAGES; page += 1) {
        const body = await getJson<{ items?: RawCalendarListEntry[]; nextPageToken?: string }>(
          "/users/me/calendarList",
          {
            fields: CALENDAR_LIST_FIELDS,
            maxResults: String(PAGE_SIZE),
            ...(pageToken ? { pageToken } : {}),
          },
          options?.signal,
        );

        for (const item of body.items ?? []) {
          if (!item.id || !item.accessRole) continue;
          calendars.push({
            accessRole: item.accessRole,
            id: item.id,
            summary: item.summaryOverride || item.summary || item.id,
            timeZone: item.timeZone ?? null,
            ...(item.primary ? { primary: true } : {}),
          });
        }

        pageToken = body.nextPageToken;
        if (!pageToken) break;
      }

      if (pageToken) throw new CalendarAccessError("calendar_unavailable");

      return { calendars, primaryTimeZone: calendars.find((calendar) => calendar.primary)?.timeZone ?? null };
    },

    async listEvents(calendarId, range, options) {
      const events: CalendarEvent[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
        const body = await getJson<{ items?: RawEvent[]; nextPageToken?: string }>(
          `/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            fields: EVENT_FIELDS,
            maxResults: String(PAGE_SIZE),
            orderBy: "startTime",
            singleEvents: "true",
            timeMax: range.end.toISOString(),
            timeMin: range.start.toISOString(),
            ...(pageToken ? { pageToken } : {}),
          },
          options?.signal,
        );

        for (const item of body.items ?? []) {
          const event = toEvent(calendarId, item);
          if (event) events.push(event);
        }

        pageToken = body.nextPageToken;
        if (!pageToken) break;
      }

      if (pageToken) throw new CalendarAccessError("calendar_unavailable");

      return events;
    },

    async conferenceSolutionTypes(calendarId, options) {
      const body = await getJson<{ conferenceProperties?: { allowedConferenceSolutionTypes?: string[] } }>(
        `/users/me/calendarList/${encodeURIComponent(calendarId)}`,
        { fields: "conferenceProperties(allowedConferenceSolutionTypes)" },
        options?.signal,
      );

      return body.conferenceProperties?.allowedConferenceSolutionTypes ?? [];
    },
  };
}

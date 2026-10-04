import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { insideWindows, seoulDay, type TimeWindow } from "@/lib/availability";

export type AppSession = { sub: string; email: string; role: "owner" | "requester"; shareId?: string };
const cookieName = "caltalk_session";
const stateCookieName = "caltalk_oauth_state";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export function supabaseAdmin() {
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) throw new Error("Missing SUPABASE_SECRET_KEY");
  return createClient(required("SUPABASE_URL"), secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
function hmac(value: string) { return createHmac("sha256", required("CALTALK_SESSION_SECRET")).update(value).digest("base64url"); }
function signed(value: string) { return `${value}.${hmac(value)}`; }
function verify(value: string) {
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const expected = Buffer.from(hmac(payload));
  const received = Buffer.from(value.slice(separator + 1));
  return expected.length === received.length && timingSafeEqual(expected, received) ? payload : null;
}
export async function setSession(session: AppSession) {
  (await cookies()).set(cookieName, signed(Buffer.from(JSON.stringify(session)).toString("base64url")), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14,
  });
}
export async function getSession(): Promise<AppSession | null> {
  const value = (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  try {
    const payload = verify(value);
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppSession;
    return parsed && typeof parsed.sub === "string" && typeof parsed.email === "string" && (parsed.role === "owner" || parsed.role === "requester") ? parsed : null;
  } catch { return null; }
}
export async function clearSession() { (await cookies()).delete(cookieName); }
export async function beginOAuthState(role: AppSession["role"], shareCode?: string) {
  const nonce = randomBytes(24).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ nonce, role, shareCode, issuedAt: Date.now() })).toString("base64url");
  (await cookies()).set(stateCookieName, signed(payload), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return signed(nonce);
}
export async function consumeOAuthState(state: string): Promise<{ role: AppSession["role"]; shareCode?: string } | null> {
  const stateNonce = verify(state);
  const jar = await cookies();
  const cookie = jar.get(stateCookieName)?.value;
  if (!stateNonce || !cookie) return null;
  const payload = verify(cookie);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { nonce: string; role: string; shareCode?: string; issuedAt: number };
    const a = Buffer.from(parsed.nonce); const b = Buffer.from(stateNonce);
    if (a.length !== b.length || !timingSafeEqual(a, b) || Date.now() - parsed.issuedAt > 10 * 60 * 1000) return null;
    if (parsed.role !== "owner" && parsed.role !== "requester") return null;
    if (parsed.shareCode && !/^[A-Za-z0-9_-]{20,100}$/.test(parsed.shareCode)) return null;
    jar.delete(stateCookieName);
    return { role: parsed.role, shareCode: parsed.shareCode };
  } catch { return null; }
}
export const OWNER_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
export async function googleAuthorizeUrl(state: string, role: AppSession["role"] = "requester") {
  const params = new URLSearchParams({
    client_id: required("GOOGLE_CLIENT_ID"), redirect_uri: `${required("APP_URL").replace(/\/$/, "")}/api/auth/google/callback`,
    response_type: "code", scope: `openid email https://www.googleapis.com/auth/calendar.events.readonly${role === "owner" ? ` ${OWNER_WRITE_SCOPE}` : ""}`, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
export function encryptToken(token: string) {
  const key = Buffer.from(required("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
export function decryptToken(value: string) {
  const key = Buffer.from(required("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted token");
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
export function appUrl(path: string) { return `${required("APP_URL").replace(/\/$/, "")}${path}`; }

export type BusyEvent = { start: Date; end: Date; location: string; busy?: boolean };
type OwnerEvent = BusyEvent & { id: string; title: string; allDay: boolean };
export async function refreshGoogleAccessToken(encryptedRefreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: required("GOOGLE_CLIENT_ID"), client_secret: required("GOOGLE_CLIENT_SECRET"), refresh_token: decryptToken(encryptedRefreshToken), grant_type: "refresh_token" }), cache: "no-store",
  });
  if (!response.ok) throw new Error("Google access token refresh failed");
  return (await response.json() as { access_token: string }).access_token;
}
export async function getCalendarEvents(encryptedRefreshToken: string, start: Date, end: Date, ownerView = false): Promise<OwnerEvent[]> {
  const accessToken = await refreshGoogleAccessToken(encryptedRefreshToken);
  const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "2500", timeZone: "Asia/Seoul", fields: `items(start(dateTime,date),end(dateTime,date),location,status,transparency${ownerView ? ",id,summary" : ""}),nextPageToken` });
  const events: OwnerEvent[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Google Calendar events request failed");
    const body = await response.json() as { items?: Array<{ id?: string; summary?: string; transparency?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; status?: string }>; nextPageToken?: string };
    for (const event of body.items ?? []) {
      if (event.status === "cancelled") continue;
      const startValue = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00+09:00` : undefined);
      const endValue = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00+09:00` : undefined);
      if (!startValue || !endValue) continue;
      events.push({ start: new Date(startValue), end: new Date(endValue), location: event.location?.trim() ?? "", id: event.id ?? String(events.length), title: event.summary ?? "제목 없는 일정", allDay: !event.start?.dateTime, busy: event.transparency !== "transparent" });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return events;
}

const seoulOffset = 9 * 60 * 60 * 1000;
function seoulDate(dayOffset: number, hour: number, minute: number) {
  return seoulDay(dayOffset, hour, minute);
}
function bufferMinutes(target: string, previous: string) {
  const targetOnline = /online|온라인|zoom|meet|teams/i.test(target);
  const previousOnline = /online|온라인|zoom|meet|teams/i.test(previous);
  if (targetOnline && previousOnline) return 0;
  if (!target || !previous) return 15;
  return targetOnline !== previousOnline ? 15 : target.trim().toLowerCase() === previous.trim().toLowerCase() ? 15 : 45;
}
export function slotIsAvailable(events: BusyEvent[], start: Date, end: Date, location: string) {
  return events.filter((event) => event.busy !== false).every((event) => {
    const buffer = bufferMinutes(location, event.location) * 60_000;
    return event.end.getTime() + buffer <= start.getTime() || event.start.getTime() - buffer >= end.getTime();
  });
}
export function labelSlot(start: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(start));
}
export function selectedSlotSuggestions(ownerEvents: BusyEvent[], requesterEvents: BusyEvent[], windows: TimeWindow[], location: string) {
  return windows.filter((slot) => Date.parse(slot.start) > Date.now() && slotIsAvailable([...ownerEvents, ...requesterEvents], new Date(slot.start), new Date(slot.end), location)).slice(0, 3)
    .map((slot, index) => ({ ...slot, label: labelSlot(slot.start), reason: "호스트가 선택한 시간 중 두 캘린더의 충돌이 없고 장소에 따른 이동 여유를 확보한 시간이에요.", rank: index + 1 }));
}
export function suggestSlots(ownerEvents: BusyEvent[], requesterEvents: BusyEvent[], duration: number, location: string, windows?: TimeWindow[] | null) {
  const start = seoulDate(1, 9, 0); const end = seoulDate(14, 20, 0);
  const events = [...ownerEvents, ...requesterEvents].filter((event) => event.busy !== false);
  const candidates: Array<{ start: Date; end: Date; score: number; reason: string }> = [];
  for (let day = 1; day <= 14; day += 1) {
    const date = seoulDate(day, 0, 0);
    const weekday = new Date(date.getTime() + seoulOffset).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let minute = 9 * 60; minute + duration <= 20 * 60; minute += 30) {
      const slotStart = seoulDate(day, Math.floor(minute / 60), minute % 60);
      const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
      if (!insideWindows(slotStart, slotEnd, windows)) continue;
      const surrounding = events.filter((event) => event.end > new Date(slotStart.getTime() - 3_600_000) && event.start < new Date(slotEnd.getTime() + 3_600_000));
      let available = true; let nearestGap = 24 * 60; let samePlace = false;
      for (const event of events) {
        if (event.end <= slotStart) {
          const gap = (slotStart.getTime() - event.end.getTime()) / 60_000;
          if (gap < 180) { nearestGap = Math.min(nearestGap, gap); if (location && event.location && location.trim().toLowerCase() === event.location.toLowerCase()) samePlace = true; }
          if (slotStart.getTime() < event.end.getTime() + bufferMinutes(location, event.location) * 60_000) { available = false; break; }
        } else if (event.start >= slotEnd) {
          const gap = (event.start.getTime() - slotEnd.getTime()) / 60_000;
          if (gap < 180) { nearestGap = Math.min(nearestGap, gap); if (location && event.location && location.trim().toLowerCase() === event.location.toLowerCase()) samePlace = true; }
          if (slotEnd.getTime() > event.start.getTime() - bufferMinutes(location, event.location) * 60_000) { available = false; break; }
        } else { available = false; break; }
      }
      if (!available || slotStart < start || slotEnd > end) continue;
      const hour = minute / 60;
      const workdayPreference = hour >= 10 && hour <= 15 ? 30 : 0;
      const score = (samePlace ? 100 : 0) + Math.min(nearestGap, 120) + workdayPreference - surrounding.length * 5;
      const reason = samePlace ? "두 캘린더가 비어 있고, 전후 일정과 같은 장소라 이동 부담이 적어요." : location ? "두 캘린더의 충돌이 없고, 장소를 고려해 전후 이동 시간을 확보했어요." : "두 캘린더의 충돌이 없는 시간이에요. 장소가 정해지면 이동 시간을 다시 확인할 수 있어요.";
      candidates.push({ start: slotStart, end: slotEnd, score, reason });
    }
  }
  const chosen: typeof candidates = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime())) {
    if (chosen.every((slot) => Math.abs(slot.start.getTime() - candidate.start.getTime()) > 3 * 60 * 60_000)) chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric",
    weekday: "short", hour: "numeric", minute: "2-digit",
  });
  return chosen.map((slot, index) => ({ start: slot.start.toISOString(), end: slot.end.toISOString(), label: formatter.format(slot.start), reason: slot.reason, rank: index + 1 }));
}

export function jsonError(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }

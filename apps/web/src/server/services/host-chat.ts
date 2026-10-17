// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import { DomainError, type OperationMeta } from "@/contracts/common"
import { hostChatSendSchema, type ChatMessage, type ChatReply, type HostChatSend, type HostChatView } from "@/contracts/host-chat"
import type { Locale, ProfileDraftView } from "@/contracts/profile"
import { one, type Db } from "../db/client"
import { listMeetingTypes, listPlaces } from "../repos/hosting"
import type { ServiceContext } from "../runtime"
import { analyzeDraft } from "./analysis"
import { readCalendarConnection } from "./calendar-sync"
import { inviteToken } from "./contacts"
import { onboardingTurn } from "./onboarding"
import { confirmProfile, createDraft, getDraft, getProfile } from "./profile"

// The host chat behind /app (contract: contracts/host-chat.ts). Today it is the profile-draft conversation:
// the host's lines are the draft's turns and Thyme's stored replies come from llm/onboarding.ts; the lines
// around them (greeting, the proposal before confirming, the booking link after) are written here.
// Changing the conversation means changing this file; the screen only draws the view.

const COPY = {
  en: {
    hello: "Hi, I'm Thyme.",
    imported: "Your imported calendar events are here. I can look at past events and suggest hours.",
    connected: "Your calendar is connected.",
    profile: "You already have a confirmed profile. Tell me if anything should change.",
    first: "Which days and hours do you usually work? No fixed hours is fine too.",
    ask: "Confirm these settings?",
    saved: "Saved.",
    linkLead: "Here's your booking link.",
    linkReady: "Anyone who opens it becomes a contact and can ask you for a meeting.",
    notReady: "To take bookings, add at least one place and one meeting type in host settings.",
    adjust: "Type what to change and send it.",
    chips: { analyze: "Analyze past events", confirm: "Use these settings", adjust: "Adjust", profile: "View my profile", host: "Open host settings" },
    proposal: {
      work: "Work", meetings: "Open for meetings", none: "None", noFixed: "No fixed hours",
      weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      days: "Preferred days", start: "Preferred start", mode: "Meeting mode", slack: "Buffer between meetings",
      strong: "important", weak: "if possible", online: "Online", offline: "In person",
    },
  },
  ko: {
    hello: "안녕하세요, Thyme이에요.",
    imported: "Calendar에서 가져온 일정이 있어요. 지난 일정을 분석해 시간을 제안할 수도 있어요.",
    connected: "Calendar가 연결돼 있어요.",
    profile: "확정한 시간 프로필이 있어요. 바꿀 점이 있으면 말해 주세요.",
    first: "보통 어떤 요일, 몇 시에 근무하세요? 고정 근무시간이 없어도 괜찮아요.",
    ask: "이대로 확정할까요?",
    saved: "저장했어요.",
    linkLead: "내 예약 링크예요.",
    linkReady: "이 링크를 받은 사람은 연락처에 추가되고 미팅을 요청할 수 있어요.",
    notReady: "예약을 받으려면 호스트 설정에서 장소와 미팅 양식을 하나 이상 등록해 주세요.",
    adjust: "바꿀 내용을 적어 보내 주세요.",
    chips: { analyze: "지난 일정 분석하기", confirm: "이 설정으로 확정", adjust: "조정할게요", profile: "내 시간 프로필 보기", host: "호스트 설정 열기" },
    proposal: {
      work: "근무", meetings: "미팅 가능", none: "없음", noFixed: "고정 근무시간 없음",
      weekdays: ["일", "월", "화", "수", "목", "금", "토"],
      days: "선호 요일", start: "선호 시작 시간", mode: "미팅 방식", slack: "미팅 사이 여유",
      strong: "중요", weak: "가능하면", online: "온라인", offline: "오프라인",
    },
  },
}
type Copy = (typeof COPY)["en"]

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`

// Weekly windows as one line, Monday first, days with the same hours joined: "Mon·Tue·Wed 13:00–18:00 / Sat 10:00–12:00".
function windowsText(windows: ProfileDraftView["values"]["meetingWindows"], weekdays: string[]): string {
  const byDay = new Map<number, string[]>()
  for (const w of [...windows].sort((a, b) => (a.weekday + 6) % 7 - (b.weekday + 6) % 7 || a.startMin - b.startMin)) {
    byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), `${hm(w.startMin)}–${hm(w.endMin)}`])
  }
  const byHours = new Map<string, number[]>()
  for (const [day, hours] of byDay) byHours.set(hours.join(", "), [...(byHours.get(hours.join(", ")) ?? []), day])
  return [...byHours].map(([hours, ds]) => `${ds.map((d) => weekdays[d]).join("·")} ${hours}`).join(" / ")
}

// The draft as Thyme reads it back before confirming; preferences the host has none of are left out.
function proposal(values: ProfileDraftView["values"], t: Copy["proposal"]): string {
  const p = values.preferences
  return [
    `${t.work}: ${values.work.mode === "none" ? t.noFixed : windowsText(values.work.windows, t.weekdays)}`,
    `${t.meetings}: ${values.meetingWindows.length ? windowsText(values.meetingWindows, t.weekdays) : t.none}`,
    ...(p.weekdays ? [`${t.days}: ${p.weekdays.value.map((d) => t.weekdays[d]).join(", ")} (${t[p.weekdays.strength]})`] : []),
    ...(p.startTime ? [`${t.start}: ${hm(p.startTime.value.startMin)}–${hm(p.startTime.value.endMin)} (${t[p.startTime.strength]})`] : []),
    ...(p.meetingMode ? [`${t.mode}: ${t[p.meetingMode.value]} (${t[p.meetingMode.strength]})`] : []),
    ...(p.slack ? [`${t.slack}: ${t[p.slack.strength]}`] : []),
  ].join("\n")
}

/** The active draft, or else the last confirmed one, so the conversation stays on screen after confirming. */
async function latestDraft(db: Db, actorId: string): Promise<ProfileDraftView | null> {
  const row = await one<{ id: string }>(db, "SELECT id FROM profile_drafts WHERE user_id=? ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1", [actorId])
  return row ? getDraft(db, actorId, row.id) : null
}

/** What the screen shows. `saved` adds the line for a confirmation that just happened; `note` is one more line from Thyme. */
export async function hostChatView(db: Db, actorId: string, locale: Locale, extra: { saved?: boolean; note?: string } = {}): Promise<HostChatView> {
  const t = COPY[locale]
  const [draft, profile, calendar, places, types] = await Promise.all([
    latestDraft(db, actorId), getProfile(db, actorId), readCalendarConnection(db, actorId), listPlaces(db, actorId), listMeetingTypes(db, actorId),
  ])
  const active = draft?.status === "active" ? draft : null
  const confirmed = !active && !!profile
  const imported = calendar.status === "connected" && !!calendar.analysis
  // An analysis message carries its evidence; once one exists the AI has already read the calendar for this draft.
  const analyzed = !!draft?.messages.some((m) => m.role === "assistant" && !!m.evidenceIds?.length)
  const ready = !!active && Object.values(active.topics).every((topic) => topic === "confirmed")
  const hostReady = places.length > 0 && types.length > 0

  const messages: ChatMessage[] = []
  const thyme = (id: string, text: string) => messages.push({ id, from: "thyme", text })
  thyme("hello", t.hello)
  if (imported) thyme("calendar", t.imported)
  else if (calendar.status === "connected") thyme("calendar", t.connected)
  const stored = draft?.messages ?? []
  if (!stored.length) thyme(profile ? "profile" : "first", profile ? t.profile : t.first)
  for (const m of stored) messages.push({ id: m.id, from: m.role === "user" ? "host" : "thyme", text: m.content })
  if (ready && active) {
    thyme(`proposal-${active.revision}`, proposal(active.values, t.proposal))
    thyme(`ask-${active.revision}`, t.ask)
  } else if (confirmed) {
    if (extra.saved) thyme("saved", t.saved)
    thyme("link-lead", t.linkLead)
    messages.push({ id: "link", from: "thyme", text: "", card: { kind: "link", path: `/invite/${await inviteToken(db, actorId)}` } })
    thyme("link-note", hostReady ? t.linkReady : t.notReady)
  }
  if (extra.note) thyme("note", extra.note)

  const replies: ChatReply[] = [
    ...(imported && !analyzed && !confirmed ? [{ id: "analyze", label: t.chips.analyze }] : []),
    ...(ready ? [{ id: "confirm", label: t.chips.confirm }, { id: "adjust", label: t.chips.adjust }] : []),
    ...(confirmed ? [hostReady ? { id: "profile", label: t.chips.profile, href: "/settings/availability" } : { id: "host", label: t.chips.host, href: "/settings/host" }] : []),
  ]
  return { messages, replies, revision: active?.revision ?? null }
}

/**
 * One message or suggested reply from the host, then the new view. Every step runs as an operation under the
 * request's key, so a retry with the same key replays instead of applying twice.
 */
export async function hostChatSend(ctx: ServiceContext, actorId: string, raw: HostChatSend, op: OperationMeta): Promise<HostChatView> {
  const input = hostChatSendSchema.parse(raw)
  const draft = await latestDraft(ctx.db, actorId)
  const active = draft?.status === "active" ? draft : null
  // The draft the host is talking to: the active one they saw, or a new one when there is none yet.
  const target = async () => {
    if (active && input.revision !== null) return { draftId: active.draftId, expectedRevision: input.revision }
    const created = await createDraft(ctx, actorId, { purpose: (await getProfile(ctx.db, actorId)) ? "edit" : "onboarding" }, op)
    return { draftId: created.draftId, expectedRevision: created.revision }
  }
  if (input.text !== undefined) {
    await onboardingTurn(ctx, actorId, { ...(await target()), text: input.text, locale: input.locale }, op)
    return hostChatView(ctx.db, actorId, input.locale)
  }
  switch (input.reply) {
    case "analyze":
      await analyzeDraft(ctx, actorId, { ...(await target()), locale: input.locale }, op)
      return hostChatView(ctx.db, actorId, input.locale)
    case "confirm":
      // Only offered with an active draft, so the revision is known; a retry finds the same draft, now confirmed.
      if (!draft || input.revision === null) throw new DomainError("invalid_input", "확정할 설정이 없어요")
      await confirmProfile(ctx, actorId, { draftId: draft.draftId, expectedRevision: input.revision, baseProfileVersion: draft.baseProfileVersion }, op)
      return hostChatView(ctx.db, actorId, input.locale, { saved: true })
    case "adjust":
      return hostChatView(ctx.db, actorId, input.locale, { note: COPY[input.locale].adjust })
    default:
      throw new DomainError("invalid_input", "알 수 없는 답장이에요")
  }
}

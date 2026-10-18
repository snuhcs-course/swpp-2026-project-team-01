import Link from "next/link"
import { DAY_MS, HORIZON_DAYS, kstDateString, kstParts, kstTimeString, kstWeekStart, parseKstDate, weekdayKo } from "@/core/time"
import { DeleteEventButton } from "@/components/DeleteEventButton"
import { EventForm } from "@/components/EventForm"
import { Badge, buttonClass, ChevronLeftIcon, ChevronRightIcon, cn, PageHeader } from "@/components/ui"
import { currentUser, db, now } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { listCalendarItems } from "@/server/services/schedule-view"
import { clipToDay, findConflicts, itemsOnDay } from "@/core/week"
import { readCalendarConnection } from "@/server/services/calendar-sync"
import { formatEventRange, PROVIDER_LABEL } from "@/components/calendar/format"
import { CalendarEventButton } from "@/components/calendar/CalendarEventPanel"
import { RefreshCalendarButton } from "@/components/calendar/RefreshCalendarButton"
import { listEvents } from "@/server/repos/events"
import { getRules } from "@/server/repos/users"
export const metadata = { title: '내 캘린더' }

const KIND_LABEL = { office: "회사", place: "장소", online: "온라인", none: "" } as const
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
const MAX_WEEK = Math.floor(HORIZON_DAYS / 7)

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams
  const week = Math.min(MAX_WEEK, Math.max(0, Number.parseInt(w ?? "0", 10) || 0))
  const me = await currentUser()
  const rules = await getRules(db(), me.id)
  const events = await listEvents(db(), me.id)
  const monday = parseKstDate(kstWeekStart(now()))! + week * 7 * DAY_MS
  const ctx = makeContext(db())
  const google = await listCalendarItems(ctx, me.id, monday - DAY_MS, monday + 8 * DAY_MS)
  const connection = await readCalendarConnection(ctx.db, me.id)
  const selectedNames = connection.sources.filter((src) => src.selected).map((src) => src.name)
  const refreshScope = connection.analysis ? "future" : "full"
  const providerLabel = PROVIDER_LABEL[google.provider ?? "google"]
  const describe = (i: { startMs: number; endMs: number; allDay: boolean; startDate: string | null; endDate: string | null }) =>
    formatEventRange({ startAt: i.startMs, endAt: i.endMs, allDay: i.allDay, startDate: i.startDate, endDate: i.endDate }).text
  const bookings = events.filter((e) => e.source === "booking").map((e) => ({ id: e.id, startMs: e.startMs, endMs: e.endMs, title: e.title }))
  const conflicts = findConflicts(bookings, google.items)
  const checkedAt = google.checkedAt === null ? null : `${kstDateString(google.checkedAt)} ${kstTimeString(google.checkedAt)}`
  // Once the example calendar is connected it carries the account's preset schedule, so those preset entries are not listed a second time.
  const shownEvents = google.provider === "mock" ? events.filter((e) => e.source !== "seed") : events
  const today = kstDateString(now())
  const days = Array.from({ length: 7 }, (_, i) => monday + i * DAY_MS)
  const disabledNav = buttonClass("secondary", "sm", "pointer-events-none opacity-40")

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="일정"
        title="내 캘린더"
        description="이 앱에서 만든 일정, 확정된 미팅, 연결한 Calendar 일정이에요. 날짜마다 미팅 허용 시간을 함께 보여줘요."
        className="mb-0"
        actions={
          <nav aria-label="주 이동" className="flex items-center gap-2">
            {week > 0 ? (
              <Link href={`/calendar?w=${week - 1}`} className={buttonClass("secondary", "sm")}><ChevronLeftIcon />이전 주</Link>
            ) : (
              <span role="link" aria-disabled="true" className={disabledNav}><ChevronLeftIcon />이전 주</span>
            )}
            <span className="px-1 text-small font-medium text-ink-soft tabular">{kstDateString(days[0])} ~ {kstDateString(days[6])}</span>
            {week < MAX_WEEK ? (
              <Link href={`/calendar?w=${week + 1}`} className={buttonClass("secondary", "sm")}>다음 주<ChevronRightIcon /></Link>
            ) : (
              <span role="link" aria-disabled="true" className={disabledNav}>다음 주<ChevronRightIcon /></span>
            )}
          </nav>
        }
      />

      <div className="space-y-2 text-small text-muted">
        {google.connected ? (
          <>
            <p>
              {providerLabel} 일정을 함께 보여줘요(읽기 전용). 선택한 캘린더 <span className="text-ink-soft">{selectedNames.join(", ") || "없음"}</span> · 마지막으로 가져온 시각{" "}
              <span className="tabular text-ink-soft">{checkedAt}</span>
            </p>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <RefreshCalendarButton selectionRevision={connection.selectionRevision} scope={refreshScope} />
              <Link href="/settings/calendars" className={buttonClass("link")}>연결 관리</Link>
            </p>
          </>
        ) : connection.status === "needs_refresh" ? (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
            캘린더 선택을 저장했어요. 일정을 가져오면 여기에 보여요.
            <RefreshCalendarButton selectionRevision={connection.selectionRevision} scope={refreshScope} />
            <Link href="/settings/calendars" className={buttonClass("link")}>연결 관리</Link>
          </p>
        ) : connection.status === "reconnect_required" ? (
          <p>Calendar 권한을 다시 연결해야 연동한 일정이 보여요. <Link href="/settings/calendars" className={buttonClass("link")}>Calendar 연결</Link></p>
        ) : (
          <p>Calendar를 연결하면 그 일정도 여기에 보여요. 지금은 이 앱의 일정 기준이에요. <Link href="/settings/calendars" className={buttonClass("link")}>Calendar 연결</Link></p>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-7">
        {days.map((dayStart) => {
          const p = kstParts(dayStart)
          const windows = rules.filter((r) => r.weekday === p.weekday && r.enabled)
          const mine = shownEvents.filter((e) => e.startMs >= dayStart && e.startMs < dayStart + DAY_MS)
          const fromGoogle = itemsOnDay(google.items, dayStart)
          const allDay = fromGoogle.filter((i) => i.allDay)
          const timed = [
            ...mine.map((e) => ({ at: e.startMs, app: e })),
            ...fromGoogle.filter((i) => !i.allDay).map((i) => ({ at: Math.max(i.startMs, dayStart), google: i })),
          ].sort((a, b) => a.at - b.at)
          const isToday = kstDateString(dayStart) === today
          const weekend = p.weekday === 0 || p.weekday === 6
          return (
            <section
              key={dayStart}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "flex min-h-28 flex-col rounded-card border bg-surface p-2.5 shadow-card md:min-h-56",
                isToday ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              <h2 className="flex items-baseline justify-between gap-1">
                <span className={cn("text-small font-semibold tabular", weekend ? "text-muted" : "text-ink")}>
                  {p.month}/{p.day}({weekdayKo(p.weekday)})
                </span>
                {isToday && <span className="rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-ink">오늘</span>}
              </h2>
              <p className="mt-0.5 mb-2 border-b border-border pb-2 text-caption text-muted tabular">
                {windows.length ? windows.map((r) => `${hm(r.startMin)}–${hm(r.endMin)}`).join(", ") : "허용 시간 없음"}
              </p>
              <ul className="space-y-1.5">
                {allDay.map((i) => (
                  <li key={`g-${i.id}-allday`}>
                    <CalendarEventButton target={{ type: "google", provider: google.provider ?? "google", eventId: i.id, title: i.title, timeText: describe(i), calendarNames: i.calendarNames, tentative: i.tentative, related: (conflicts.byItem[i.id] ?? []).map((b) => ({ title: b.title, timeText: describe({ startMs: b.startMs, endMs: b.endMs, allDay: false, startDate: null, endDate: null }) })) }}>
                      <div className="rounded-md border-l-[3px] border-l-primary bg-primary-soft px-2 py-1.5 text-caption text-primary-soft-ink">
                        <div className="font-semibold">종일</div>
                        <div className="break-words">{i.title}{i.tentative ? " (미정)" : ""}</div>
                        <div className="mt-0.5 text-muted">{providerLabel}{i.calendarNames.length > 1 ? ` · ${i.calendarNames.length}개 캘린더` : ""}</div>
                        {conflicts.byItem[i.id] && <Badge tone="warn" className="mt-1">확정 미팅과 겹쳐요</Badge>}
                      </div>
                    </CalendarEventButton>
                  </li>
                ))}
                {timed.map((entry) => {
                  if ("google" in entry) {
                    const i = entry.google, { fromMin, toMin } = clipToDay(i, dayStart)
                    const body = (
                      <div className={cn("rounded-md border-l-[3px] px-2 py-1.5 text-caption", i.kind === "busy" ? "border-l-border-strong bg-surface-sunken text-muted" : "border-l-primary bg-primary-soft text-primary-soft-ink")}>
                        <div className="font-semibold tabular">{hm(fromMin)}–{hm(toMin)}</div>
                        <div className="break-words">{i.title}{i.tentative ? " (미정)" : ""}</div>
                        <div className="mt-0.5 text-muted">{i.kind === "busy" ? `${providerLabel} · 바쁨만 공유된 캘린더` : `${providerLabel}${i.calendarNames.length > 1 ? ` · ${i.calendarNames.length}개 캘린더` : ""}`}</div>
                        {conflicts.byItem[i.id] && <Badge tone="warn" className="mt-1">확정 미팅과 겹쳐요</Badge>}
                      </div>
                    )
                    if (i.kind === "busy") return <li key={`g-${i.id}`}>{body}</li>
                    return (
                      <li key={`g-${i.id}`}>
                        <CalendarEventButton target={{ type: "google", provider: google.provider ?? "google", eventId: i.id, title: i.title, timeText: describe(i), calendarNames: i.calendarNames, tentative: i.tentative, related: (conflicts.byItem[i.id] ?? []).map((b) => ({ title: b.title, timeText: describe({ startMs: b.startMs, endMs: b.endMs, allDay: false, startDate: null, endDate: null }) })) }}>{body}</CalendarEventButton>
                      </li>
                    )
                  }
                  const e = entry.app
                  const clash = conflicts.byBooking[e.id]
                  if (e.source === "booking") {
                    return (
                      <li key={e.id}>
                        <CalendarEventButton target={{ type: "booking", title: e.title, timeText: describe({ startMs: e.startMs, endMs: e.endMs, allDay: false, startDate: null, endDate: null }), placeText: [KIND_LABEL[e.kind], e.kind === "place" ? e.placeRef : null].filter(Boolean).join(" · "), related: (clash ?? []).map((i) => ({ title: i.title, timeText: describe(i) })) }}>
                          <div className="rounded-md border-l-[3px] border-l-success bg-success-soft px-2 py-1.5 text-caption text-success-ink">
                            <div className="font-semibold tabular">{kstTimeString(e.startMs)}–{kstTimeString(e.endMs)}</div>
                            <div className="break-words">{e.title}</div>
                            <div className="mt-0.5 text-muted">{["확정 미팅", KIND_LABEL[e.kind], e.kind === "place" ? e.placeRef : null].filter(Boolean).join(" · ")}</div>
                            {clash && <Badge tone="warn" className="mt-1">겹치는 외부 일정 {clash.length}건</Badge>}
                          </div>
                        </CalendarEventButton>
                      </li>
                    )
                  }
                  return (
                    <li key={e.id} className="rounded-md border-l-[3px] border-l-border-strong bg-surface-sunken px-2 py-1.5 text-caption text-ink">
                      <div className="font-semibold tabular">{kstTimeString(e.startMs)}–{kstTimeString(e.endMs)}</div>
                      <div className="break-words">{e.title}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-1 text-muted">
                        <span>{[KIND_LABEL[e.kind], e.kind === "place" ? e.placeRef : null].filter(Boolean).join(" · ")}</span>
                        <DeleteEventButton id={e.id} />
                      </div>
                    </li>
                  )
                })}
                {allDay.length + timed.length === 0 && <li className="text-caption text-subtle">일정 없음</li>}
              </ul>
            </section>
          )
        })}
      </div>

      <EventForm defaultDate={today} />
    </div>
  )
}

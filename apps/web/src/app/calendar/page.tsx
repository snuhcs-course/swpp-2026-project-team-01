import Link from "next/link"
import { DAY_MS, HORIZON_DAYS, kstDateString, kstParts, kstTimeString, kstWeekStart, parseKstDate, weekdayKo } from "@/core/time"
import { DeleteEventButton } from "@/components/DeleteEventButton"
import { EventForm } from "@/components/EventForm"
import { currentUser, db, now } from "@/server/context"
import { listEvents } from "@/server/repos/events"
import { getRules } from "@/server/repos/users"

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
  const today = kstDateString(now())
  const days = Array.from({ length: 7 }, (_, i) => monday + i * DAY_MS)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">내 캘린더</h1>
        <div className="flex items-center gap-2 text-sm">
          {week > 0 ? <Link href={`/calendar?w=${week - 1}`} className="rounded border border-slate-300 px-2 py-1">← 이전 주</Link> : <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">← 이전 주</span>}
          <span className="text-slate-500">{kstDateString(days[0])} ~ {kstDateString(days[6])}</span>
          {week < MAX_WEEK ? <Link href={`/calendar?w=${week + 1}`} className="rounded border border-slate-300 px-2 py-1">다음 주 →</Link> : <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">다음 주 →</span>}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-7">
        {days.map((dayStart) => {
          const p = kstParts(dayStart)
          const rule = rules.find((r) => r.weekday === p.weekday)!
          const list = events.filter((e) => e.startMs >= dayStart && e.startMs < dayStart + DAY_MS)
          const isToday = kstDateString(dayStart) === today
          return (
            <section key={dayStart} className={`rounded-lg border bg-white p-2 ${isToday ? "border-indigo-400" : "border-slate-200"}`}>
              <h2 className="text-sm font-medium">
                {p.month}/{p.day}({weekdayKo(p.weekday)})
              </h2>
              <p className="mb-2 text-xs text-slate-400">{rule.enabled ? `가능 ${hm(rule.startMin)}–${hm(rule.endMin)}` : "쉬는 날"}</p>
              <ul className="space-y-1">
                {list.map((e) => (
                  <li key={e.id} className={`rounded px-2 py-1 text-xs ${e.source === "booking" ? "bg-emerald-50 text-emerald-900" : "bg-slate-100"}`}>
                    <div className="font-medium">{kstTimeString(e.startMs)}–{kstTimeString(e.endMs)}</div>
                    <div>{e.title}</div>
                    <div className="flex items-center justify-between text-slate-500">
                      <span>{[KIND_LABEL[e.kind], e.kind === "place" ? e.placeRef : null].filter(Boolean).join(" · ")}</span>
                      {e.source !== "booking" && <DeleteEventButton id={e.id} />}
                    </div>
                  </li>
                ))}
                {list.length === 0 && <li className="text-xs text-slate-300">일정 없음</li>}
              </ul>
            </section>
          )
        })}
      </div>

      <EventForm defaultDate={today} />
    </div>
  )
}

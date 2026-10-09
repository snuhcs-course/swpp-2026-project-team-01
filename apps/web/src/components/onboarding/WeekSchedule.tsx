// AI-generated with Codex (gpt-6-astra), 2026-10-05; Claude Code (claude-opus-5-5), 2026-10-05
import { days, timeText, type Values } from './draftReducer'

// Monday-first, the way a working week is read.
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const TICKS = [0, 6, 12, 18, 24]
const pct = (min: number) => `${(min / 1440) * 100}%`

export function WeekSchedule({ values }: { values: Values }) {
  return <section aria-label="주간표" className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="font-semibold text-ink">주간표 · 한국 시간</h3>
      <p aria-hidden="true" className="flex items-center gap-3 text-caption text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-track-work" />근무</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-primary" />미팅 허용</span>
      </p>
    </div>
    <p className="mb-4 text-caption text-muted">근무 / 미팅 허용 · 외부 일정의 빈 시간 조회 결과는 아니에요.</p>
    <div aria-hidden="true" className="relative mb-1 ml-10 h-4 text-[0.6875rem] text-subtle tabular">
      {TICKS.map(h => <span key={h} className="absolute whitespace-nowrap" style={{ left: pct(h * 60), transform: `translateX(${h === 0 ? '0' : h === 24 ? '-100%' : '-50%'})` }}>{h}시</span>)}
    </div>
    <ul className="space-y-2.5">{ORDER.map(weekday => {
      const day = days[weekday]
      const work = values.work.windows.filter(w => w.weekday === weekday)
      const meeting = values.meetingWindows.filter(w => w.weekday === weekday)
      const weekend = weekday === 0 || weekday === 6
      return <li key={day} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2">
        <span className={`pt-0.5 text-small font-semibold ${weekend ? 'text-muted' : 'text-ink'}`}>{day}</span>
        <div className="min-w-0">
          <div aria-hidden="true" className="relative h-5 overflow-hidden rounded-md bg-surface-sunken">
            {TICKS.slice(1, -1).map(h => <span key={h} className="absolute inset-y-0 w-px bg-border" style={{ left: pct(h * 60) }} />)}
            {work.map((w, i) => <span key={`w${i}`} className="absolute top-0 h-2 rounded-sm bg-track-work" style={{ left: pct(w.startMin), width: pct(w.endMin - w.startMin) }} />)}
            {meeting.map((w, i) => <span key={`m${i}`} className="absolute bottom-0 h-2.5 rounded-sm bg-primary" style={{ left: pct(w.startMin), width: pct(w.endMin - w.startMin) }} />)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-caption tabular">
            {work.map((w, i) => <p key={`w${i}`} className="text-muted">근무 {timeText(w.startMin)}–{timeText(w.endMin)}</p>)}
            {meeting.map((w, i) => <p key={`m${i}`} className="font-medium text-primary">미팅 허용 {timeText(w.startMin)}–{timeText(w.endMin)}</p>)}
            {!work.length && !meeting.length && <span className="text-subtle">설정한 구간 없음</span>}
          </div>
        </div>
      </li>
    })}</ul>
  </section>
}

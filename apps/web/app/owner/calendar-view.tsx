// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
"use client";

import { useEffect, useRef, useState } from "react";
import { DAY_MS, SEOUL_OFFSET, type CalendarEvent, type TimeWindow } from "@/lib/availability";
import styles from "./owner.module.css";

export type CalendarData = {
  events: CalendarEvent[]; windows: TimeWindow[]; period: TimeWindow;
  calendarStart: string; calendarEnd: string; today: string; updatedAt: string;
};
export const shortDate = (value: string | number) => new Date(value).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
export const clockTime = (value: string | number) => new Date(value).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

function positionEvents(events: CalendarEvent[], day: number) {
  const sorted = events.filter((event) => !event.allDay && Date.parse(event.start) < day + DAY_MS && Date.parse(event.end) > day)
    .map((event) => ({ event, start: Math.max(day, Date.parse(event.start)), end: Math.min(day + DAY_MS, Date.parse(event.end)), lane: 0, columns: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: typeof sorted = []; let groupEnd = 0; let lanes: number[] = [];
  function finishGroup() { for (const item of group) item.columns = lanes.length; group = []; lanes = []; }
  for (const item of sorted) {
    if (item.start >= groupEnd) finishGroup();
    let lane = lanes.findIndex((end) => end <= item.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = item.end; item.lane = lane;
    group.push(item); groupEnd = Math.max(groupEnd, item.end);
  }
  finishGroup();
  return sorted;
}

export default function CalendarView({ data, loading, error, onRefresh }: { data: CalendarData | null; loading: boolean; error: string; onRefresh: () => void }) {
  const [week, setWeek] = useState(0);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (data && scroll.current) scroll.current.scrollTop = 8 * 60; }, [data]);
  const start = data ? Date.parse(data.calendarStart) + week * 7 * DAY_MS : 0;
  const days = Array.from({ length: 7 }, (_, index) => start + index * DAY_MS);
  return <section className={styles.calendar} aria-label="내 Google Calendar">
    <div className={styles.calendarToolbar}>
      <div className={styles.row}><h2>{data ? `${new Date(start + SEOUL_OFFSET).getUTCFullYear()}년 ${new Date(start + SEOUL_OFFSET).getUTCMonth() + 1}월` : "내 캘린더"}</h2>
        <button className={styles.secondary} onClick={() => setWeek(0)} disabled={!data}>오늘</button>
        <button className={styles.arrow} aria-label="이전 주" disabled={!data || week === 0} onClick={() => setWeek(week - 1)}>‹</button>
        <button className={styles.arrow} aria-label="다음 주" disabled={!data || week === 2} onClick={() => setWeek(week + 1)}>›</button>
      </div>
      <div className={styles.row}><span className={styles.muted}>주간 · 서울 시간</span><button className={styles.secondary} onClick={onRefresh} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button></div>
    </div>
    <div className={styles.legend}><span><i className={styles.blueDot} />Google 일정</span><span><i className={styles.greenDot} />미팅 가능 시간</span><span className={styles.muted}>기본 캘린더 · 일정 조회</span></div>
    {error && <div role="alert" className={styles.error}>{error} <a href="/api/auth/google/start?role=owner&reconnect=1">다시 연결</a></div>}
    {!data ? <div className={styles.empty}>{loading ? "Google Calendar의 일정을 불러오고 있어요…" : "캘린더를 불러오면 일정과 미팅 가능한 시간이 여기에 표시됩니다."}</div> : <>
      <div className={styles.calendarScroll} ref={scroll} aria-busy={loading}>
        <div className={styles.calendarGrid}>
          <div className={styles.dayHeader}><div className={styles.timezone}>GMT+9</div>{days.map((day) => <div key={day} className={styles.dayName}>
            <span>{new Date(day).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" })}</span>
            <strong className={day === Date.parse(data.today) ? styles.today : undefined}>{new Date(day + SEOUL_OFFSET).getUTCDate()}</strong>
            <div className={styles.allDay}>{data.events.filter((event) => event.allDay && Date.parse(event.start) < day + DAY_MS && Date.parse(event.end) > day).map((event) => <button key={event.id} onClick={() => setSelected(event)} title={event.title}>{event.title}{!event.busy ? " · 한가함" : ""}</button>)}</div>
          </div>)}</div>
          <div className={styles.weekBody}>
            <div className={styles.timeAxis}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * 60 }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
            {days.map((day) => <div key={day} className={styles.dayColumn} aria-label={shortDate(day)}>
              {data.windows.filter((window) => Date.parse(window.start) < day + DAY_MS && Date.parse(window.end) > day).map((window) => <div key={window.start} className={styles.available} style={{ top: (Date.parse(window.start) - day) / 60_000, height: (Date.parse(window.end) - Date.parse(window.start)) / 60_000 }} title={`미팅 가능 · ${clockTime(window.start)}–${clockTime(window.end)}`}><b>미팅 가능</b><span>{clockTime(window.start)}–{clockTime(window.end)}</span></div>)}
              {positionEvents(data.events, day).map(({ event, start: eventStart, end, lane, columns }) => <button key={event.id} className={`${styles.event} ${!event.busy ? styles.freeEvent : ""}`} onClick={() => setSelected(event)} style={{ top: (eventStart - day) / 60_000, height: Math.max(18, (end - eventStart) / 60_000 - 2), left: `calc(${lane * 100 / columns}% + 3px)`, width: `calc(${100 / columns}% - 6px)` }} title={`${event.title} · ${clockTime(event.start)}–${clockTime(event.end)}${event.location ? ` · ${event.location}` : ""}`}><b>{event.title}</b><span>{clockTime(event.start)}–{clockTime(event.end)}</span></button>)}
            </div>)}
          </div>
        </div>
      </div>
      <p className={styles.calendarNote}>초록 영역은 내 일정과 기본 조건으로 계산한 시간입니다. 상대방 일정·미팅 장소에 따라 실제 후보는 줄어들 수 있어요. {data.windows.length === 0 && "현재 조건에 맞는 빈 시간이 없습니다."}</p>
    </>}
    {selected && <div className={styles.eventDetail} role="region" aria-label="일정 상세"><div className={styles.row}><strong>{selected.title}</strong><button className={styles.secondary} onClick={() => setSelected(null)}>닫기</button></div><p>{shortDate(selected.start)} · {selected.allDay ? "종일" : `${clockTime(selected.start)}–${clockTime(selected.end)}`}</p>{selected.location && <p>{selected.location}</p>}{!selected.busy && <p>Google Calendar에서 ‘한가함’으로 설정된 일정입니다.</p>}</div>}
  </section>;
}

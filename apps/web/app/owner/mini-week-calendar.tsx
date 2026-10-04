"use client";
import { useState } from "react";
import { DAY_MS, SEOUL_OFFSET, type TimeWindow } from "@/lib/availability";
import { clockTime, shortDate } from "./calendar-view";
import styles from "./owner.module.css";

export default function MiniWeekCalendar({ windows }: { windows: TimeWindow[] }) {
  const [week, setWeek] = useState(0);
  if (!windows.length) return <p className={styles.muted}>공개한 시간이 없습니다.</p>;
  const ordered = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  const first = new Date(Date.parse(ordered[0].start) + SEOUL_OFFSET);
  first.setUTCHours(0, 0, 0, 0);
  const monday = first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS - SEOUL_OFFSET;
  const last = Math.max(...ordered.map((slot) => Date.parse(slot.end) - 1));
  const maxWeek = Math.floor((last - monday) / (7 * DAY_MS));
  const effectiveWeek = Math.min(week, maxWeek);
  const start = monday + effectiveWeek * 7 * DAY_MS;
  const days = Array.from({ length: 7 }, (_, i) => start + i * DAY_MS);
  return <div className={styles.miniCalendar}>
    <div className={styles.miniToolbar}><button type="button" className={styles.arrow} aria-label="공개 시간 이전 주" disabled={effectiveWeek === 0} onClick={() => setWeek(effectiveWeek - 1)}>‹</button><strong>{shortDate(start)} – {shortDate(start + 6 * DAY_MS)}</strong><button type="button" className={styles.arrow} aria-label="공개 시간 다음 주" disabled={effectiveWeek >= maxWeek} onClick={() => setWeek(effectiveWeek + 1)}>›</button></div>
    <div className={styles.miniScroll}><div className={styles.miniGrid}>
      <div className={styles.miniHeader}><span>KST</span>{days.map((day) => <span key={day}>{new Date(day).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", weekday: "short", day: "numeric" })}</span>)}</div>
      <div className={styles.miniBody}><div className={styles.miniAxis}>{Array.from({ length: 12 }, (_, i) => <span key={i} style={{ top: i * 30 }}>{String(i + 9).padStart(2, "0")}</span>)}</div>
        {days.map((day) => <div key={day} className={styles.miniDay}>{ordered.filter((slot) => Date.parse(slot.start) >= day && Date.parse(slot.start) < day + DAY_MS).map((slot) => <div key={slot.start} className={styles.miniSlot} style={{ top: (Date.parse(slot.start) - day - 9 * 3_600_000) / 120_000, height: (Date.parse(slot.end) - Date.parse(slot.start)) / 120_000 }} title={`${shortDate(slot.start)} ${clockTime(slot.start)}–${clockTime(slot.end)}`}><span>{clockTime(slot.start)}</span><span>{clockTime(slot.end)}</span></div>)}</div>)}
      </div>
    </div></div>
    <p className={styles.muted}>공개한 시간 · 서울 기준 · {effectiveWeek + 1}/{maxWeek + 1}주</p>
  </div>;
}

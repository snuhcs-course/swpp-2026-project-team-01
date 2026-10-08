// AI-generated with OpenAI Codex, 2026-10-04.
"use client";

import Link from "next/link";
import SignOut from "../account/sign-out";
import { useCallback, useEffect, useRef, useState } from "react";
import { readJsonResponse } from "@/lib/client-json";
import CalendarView, { type CalendarData, shortDate } from "./calendar-view";
import LinkManager from "./link-manager";
import ReceivedRequests, { type Share } from "./received-requests";
import styles from "./owner.module.css";

export default function OwnerDashboard({ email }: { email: string }) {
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState("");
  const [shares, setShares] = useState<Share[]>([]);
  const [requestError, setRequestError] = useState("");
  const requestSequence = useRef(0);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true); setCalendarError("");
    try { setCalendar(await readJsonResponse<CalendarData>(await fetch("/api/calendar/events", { cache: "no-store" }), "캘린더를 불러오지 못했습니다.")); }
    catch (cause) { setCalendarError(cause instanceof Error ? cause.message : "캘린더를 불러오지 못했습니다."); }
    finally { setCalendarLoading(false); }
  }, []);
  const loadRequests = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const result = await readJsonResponse<{ links: Share[] }>(await fetch("/api/requests", { cache: "no-store" }), "요청을 불러오지 못했습니다.");
      if (sequence !== requestSequence.current) return;
      setShares(result.links); setRequestError("");
    } catch (cause) {
      if (sequence === requestSequence.current) setRequestError(cause instanceof Error ? cause.message : "요청을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void loadCalendar(); void loadRequests(); }, 0);
    return () => clearTimeout(timer);
  }, [loadCalendar, loadRequests]);
  useEffect(() => {
    const refreshRequests = () => {
      if (document.visibilityState === "visible") void loadRequests();
    };
    window.addEventListener("focus", refreshRequests);
    document.addEventListener("visibilitychange", refreshRequests);
    return () => {
      window.removeEventListener("focus", refreshRequests);
      document.removeEventListener("visibilitychange", refreshRequests);
      requestSequence.current += 1;
    };
  }, [loadRequests]);

  return <main className={styles.shell}>
    <header className={styles.header}><Link href="/owner" className={styles.brand}>Caltalk<span>.</span></Link><div className={styles.account}><i /><span>Google Calendar 연결 · {email}</span><Link href="/account">내 계정</Link><SignOut/></div></header>
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="메뉴와 미팅 조건">
        <nav><a href="#my-calendar">▦ 내 캘린더</a><a href="#share-links">↗ 요청 링크</a><a href="#received-requests" onClick={() => void loadRequests()}>▤ 받은 요청</a></nav>
        <section className={styles.rules}><h2>내 미팅 조건</h2><dl>
          <div><dt>후보를 찾는 기간</dt><dd>내일부터 14일{calendar && <><br /><span className={styles.muted}>{shortDate(calendar.period.start)}<br />– {shortDate(calendar.period.end)}</span></>}</dd></div>
          <div><dt>가능한 요일과 시간</dt><dd>월요일 – 금요일<br />09:00 – 20:00</dd></div>
          <div><dt>주말 · 공휴일</dt><dd>토·일 제외<br /><span className={styles.muted}>공휴일은 별도로 제외하지 않아요.</span></dd></div>
          <div><dt>캘린더에 표시하는 빈 시간</dt><dd>30분 이상<br /><span className={styles.muted}>시작 시각은 30분 간격<br />전후 일정과 15분 여유</span></dd></div>
          <div><dt>요청을 받을 때의 이동 여유</dt><dd>대면 장소가 다르면 45분<br /><span className={styles.muted}>같거나 미정이면 15분<br />온라인 ↔ 대면은 15분<br />온라인끼리는 0분</span></dd></div>
          <div><dt>기준 시간대</dt><dd>서울 · Asia/Seoul</dd></div>
        </dl><p className={styles.ruleNote}>현재는 기본 규칙으로 계산합니다. AI 모델은 아직 연결하지 않았어요. 개인 조건과 가능 시간 수정은 다음 단계에서 제공할 예정입니다.</p></section>
      </aside>
      <div className={styles.content}>
        <section id="my-calendar"><div className={styles.welcome}><p className={styles.eyebrow}>YOUR TIME, AT A GLANCE</p><h1>내 일정과 미팅 가능한 시간</h1><p>캘린더를 확인하고, 편한 시간을 요청 링크로 공유하세요.</p></div><CalendarView data={calendar} loading={calendarLoading} error={calendarError} onRefresh={() => void loadCalendar()} /></section>
        <LinkManager calendar={calendar} onChange={() => { void loadRequests(); void loadCalendar(); }} />
        <section id="received-requests">{requestError && <p className={styles.error} role="alert">{requestError} <button onClick={() => void loadRequests()}>다시 불러오기</button></p>}<ReceivedRequests shares={shares} /></section>
      </div>
    </div>
  </main>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type TimeWindow } from "@/lib/availability";
import { readJsonResponse } from "@/lib/client-json";
import { shortDate, clockTime, type CalendarData } from "./calendar-view";
import styles from "./owner.module.css";
import CreateLinkForm from "./create-link-form";
import MiniWeekCalendar from "./mini-week-calendar";
import RequestApproval, { type MeetingRequest } from "./request-approval";

type ShareLink = {
  id: string; name: string; active: boolean; created_at: string; url: string | null;
  availability_start: string | null; availability_end: string | null; availability_windows: TimeWindow[] | null;
  meeting_duration_minutes: number | null;
  meeting_requests: MeetingRequest[];
};
function WindowList({ windows }: { windows: TimeWindow[] }) {
  const grouped = new Map<string, string[]>();
  for (const window of windows) {
    const date = shortDate(window.start);
    grouped.set(date, [...(grouped.get(date) ?? []), `${clockTime(window.start)}–${clockTime(window.end)}`]);
  }
  return <dl className={styles.windowList}>{[...grouped].map(([date, times]) => <div key={date}><dt>{date}</dt><dd>{times.join(" / ")}</dd></div>)}</dl>;
}

export default function LinkManager({ calendar, onChange }: { calendar: CalendarData | null; onChange: () => void }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now, setNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = links.find((link) => link.id === selectedId);
  const expired = (link: ShareLink) => !!link.availability_end && Date.parse(link.availability_end) <= now;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readJsonResponse<{ links: ShareLink[]; calendarWriteEnabled: boolean }>(await fetch("/api/share", { cache: "no-store" }), "링크를 불러오지 못했습니다.");
      setLinks(result.links); setCanWrite(result.calendarWriteEnabled); setNow(Date.now()); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "링크를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  async function created(id: string) {
    dialog.current?.close(); setSelectedId(id); setConfirmDelete(false);
    setMessage("선택한 시간으로 요청 링크를 만들었어요. 주소를 복사해 공유하세요.");
    await load(); onChange();
  }
  async function change(link: ShareLink, deleting = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      await readJsonResponse(await fetch(`/api/share/${link.id}`, { method: deleting ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, ...(deleting ? {} : { body: JSON.stringify({ active: !link.active }) }) }), "링크를 변경하지 못했습니다.");
      if (deleting) { setSelectedId(null); setMessage("링크를 삭제했어요. 이 링크와 받은 요청은 목록에서 숨겨집니다."); }
      else setMessage(link.active ? "링크를 닫았어요. 새 요청을 받지 않습니다." : "링크를 다시 열었어요.");
      setConfirmDelete(false); await load(); onChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "링크를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setMessage("링크를 복사했어요."); }
    catch { setMessage("자동 복사가 안 되면 아래 주소를 선택해 직접 복사해 주세요."); }
  }

  return <section id="share-links" className={styles.section}>
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SHARE YOUR TIME</p><h2>요청 링크</h2><p className={styles.muted}>상대방과 공유할 링크를 만들고 관리하세요.</p></div><button className={styles.primary} disabled={busy} onClick={() => { setFormKey((key) => key + 1); dialog.current?.showModal(); }}>＋ 요청 링크 만들기</button></div>
    {error && <div className={styles.error} role="alert">{error} <button onClick={() => void load()} disabled={loading}>다시 불러오기</button></div>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    {loading && !links.length ? <p className={styles.empty}>링크를 불러오고 있어요…</p> : !links.length ? <div className={styles.empty}>아직 요청 링크가 없어요. 이름을 붙여 첫 링크를 만들어 보세요.</div> : <div className={styles.linkLayout}>
      <div className={styles.linkList}>{links.map((link) => <button key={link.id} className={`${styles.linkCard} ${selectedId === link.id ? styles.selectedLink : ""}`} aria-expanded={selectedId === link.id} onClick={() => { setSelectedId(link.id); setConfirmDelete(false); }}>
        <div className={styles.row}><strong>{link.name}</strong><span className={link.active && !expired(link) ? styles.openBadge : styles.closedBadge}>{expired(link) ? "기간 종료" : link.active ? "열림" : "닫힘"}</span></div>
        <p>{shortDate(link.created_at)} 생성 · 받은 요청 {link.meeting_requests.length}개</p><span className={styles.detailHint}>상세 정보 보기 →</span>
      </button>)}</div>
      {selected ? <article className={styles.linkDetail} aria-label={`${selected.name} 링크 상세`}>
        <div className={styles.sectionHeading}><h3>{selected.name}</h3><button className={styles.secondary} onClick={() => { setSelectedId(null); setConfirmDelete(false); }}>상세 닫기</button></div>
        <div className={styles.row}><button type="button" role="switch" aria-checked={selected.active && !expired(selected)} className={styles.toggle} disabled={busy || expired(selected)} onClick={() => void change(selected)}><span className={selected.active && !expired(selected) ? styles.toggleOn : styles.toggleOff}><i /></span>{expired(selected) ? "공개 기간이 끝났어요" : selected.active ? "링크 열림" : "링크 닫힘"}</button><span className={styles.muted}>{!expired(selected) && "눌러서 열기 / 닫기"}</span></div>
        {selected.url ? <div className={styles.copyRow}><input aria-label="공유할 요청 링크 주소" readOnly value={selected.url} onFocus={(event) => event.currentTarget.select()} /><button className={styles.secondary} onClick={() => { if (selected.url) void copy(selected.url); }}>복사</button></div> : <p className={styles.muted}>이 링크는 주소를 다시 불러올 수 없어요. 이전에 공유한 주소로 이용하거나 새 링크를 만들어 주세요.</p>}
        <h4>공개한 시간대 <span className={styles.muted}>{selected.meeting_duration_minutes ? `${selected.meeting_duration_minutes}분 미팅 · ` : ""}서울 시간</span></h4>
        {selected.availability_start && selected.availability_end ? <p>{shortDate(selected.availability_start)} – {shortDate(selected.availability_end)}</p> : <p className={styles.muted}>기존 링크 · 요청 시점부터 14일 동안의 현재 조건을 적용합니다.</p>}
        <p className={styles.muted}>{selected.availability_windows ? "링크를 만들 때 저장한 시간입니다. 이후 추가된 일정과 상대방의 일정은 요청 시 다시 확인합니다." : "아래는 현재 캘린더 기준의 가능 시간입니다."}</p>
        {selected.availability_windows || calendar ? <><MiniWeekCalendar key={selected.id} windows={selected.availability_windows ?? calendar?.windows ?? []} /><details><summary className={styles.muted}>공개 시간 목록 보기</summary><WindowList windows={selected.availability_windows ?? calendar?.windows ?? []} /></details></> : <p className={styles.muted}>캘린더를 불러오면 가능 시간을 확인할 수 있습니다.</p>}
        <h4>이 링크로 들어온 요청 · {selected.meeting_requests.length}</h4>
        {selected.meeting_requests.length ? <ul className={styles.requesters}>{selected.meeting_requests.map((request) => <RequestApproval key={request.id} request={request} canWrite={canWrite} sharedBusy={busy} onBusy={setBusy} onChange={async () => { await load(); onChange(); }} />)}</ul> : <p className={styles.muted}>아직 들어온 요청이 없어요.</p>}
        <div className={styles.deleteArea}>{confirmDelete ? <><p>이 링크를 삭제할까요? 다시 열 수 없으며, 이 링크로 받은 요청도 목록에서 숨겨집니다. 기록은 보관됩니다.</p><div className={styles.row}><button className={styles.danger} disabled={busy} onClick={() => void change(selected, true)}>{busy ? "처리 중…" : "삭제하기"}</button><button className={styles.secondary} disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button></div></> : <button className={styles.danger} disabled={busy} onClick={() => setConfirmDelete(true)}>링크 삭제</button>}</div>
      </article> : <div className={styles.detailPlaceholder}>링크를 선택하면 공개 시간과 요청자를 확인할 수 있어요.</div>}
    </div>}
    <dialog className={styles.dialog} ref={dialog} aria-labelledby="create-link-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <CreateLinkForm key={formKey} onCreated={created} onBusy={setBusy} onCancel={() => dialog.current?.close()} />

    </dialog>
  </section>;
}

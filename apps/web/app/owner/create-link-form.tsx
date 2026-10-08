// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
"use client";
import { useState, type FormEvent } from "react";
import { defaultLinkOptions, MEETING_DURATIONS, type LinkOptions } from "@/lib/link-options";
import type { TimeWindow } from "@/lib/availability";
import { readJsonResponse } from "@/lib/client-json";
import { clockTime, shortDate } from "./calendar-view";
import styles from "./owner.module.css";

const timeOptions = Array.from({ length: 23 }, (_, i) => `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
export default function CreateLinkForm({ onCreated, onCancel, onBusy }: { onCreated: (id: string) => Promise<void>; onCancel: () => void; onBusy: (busy: boolean) => void }) {
  const [name, setName] = useState("");
  const [bounds] = useState(() => defaultLinkOptions());
  const [options, setOptions] = useState<LinkOptions>(() => defaultLinkOptions());
  const [candidates, setCandidates] = useState<TimeWindow[] | null>(null);
  const [preview, setPreview] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function update(patch: Partial<LinkOptions>) { setOptions({ ...options, ...patch }); setCandidates(null); setPreview(""); setSelected([]); setError(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); onBusy(true); setError("");
    try {
      if (!preview) {
        const result = await readJsonResponse<{ candidates: TimeWindow[]; preview: string }>(await fetch("/api/share/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) }), "후보를 조회하지 못했습니다.");
        setCandidates(result.candidates); setPreview(result.preview); setSelected([]);
      } else {
        const result = await readJsonResponse<{ id: string }>(await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, preview, selectedStarts: selected }) }), "링크를 만들지 못했습니다.");
        await onCreated(result.id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <form onSubmit={submit}>
    <p className={styles.eyebrow}>{preview ? "02 / SELECT TIMES" : "01 / SET YOUR AVAILABILITY"}</p><h2 id="create-link-title">공개할 미팅 시간을 정해 주세요</h2>
    <p className={styles.muted}>범위와 길이를 정한 뒤 후보 5개 중 2개 이상을 선택하세요.</p>
    <fieldset disabled={busy} className={styles.formFields}>
      <label htmlFor="link-name">링크 이름</label><input id="link-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus placeholder="예: 10월 투자 미팅" />
      <label htmlFor="meeting-duration">미팅 길이</label><select id="meeting-duration" value={options.duration} onChange={(event) => update({ duration: Number(event.target.value) })}>{MEETING_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration < 60 ? `${duration}분` : `${Math.floor(duration / 60)}시간${duration % 60 ? ` ${duration % 60}분` : ""}`}</option>)}</select>
      <div className={styles.formColumns}><div><label htmlFor="publish-from">공개 시작일</label><input id="publish-from" type="date" required min={bounds.from} max={bounds.to} value={options.from} onChange={(event) => update({ from: event.target.value })} /></div><div><label htmlFor="publish-to">공개 종료일</label><input id="publish-to" type="date" required value={options.to} onChange={(event) => update({ to: event.target.value })} /></div></div>
      <p className={styles.muted}>내일부터 14일 이내로 선택할 수 있어요. 모든 시각은 서울 기준입니다.</p>
      <div className={styles.formColumns}><div><label htmlFor="publish-start">하루 중 시작 시각</label><select id="publish-start" value={options.startTime} onChange={(event) => update({ startTime: event.target.value })}>{timeOptions.slice(0, -1).map((time) => <option key={time}>{time}</option>)}</select></div><div><label htmlFor="publish-end">하루 중 종료 시각</label><select id="publish-end" value={options.endTime} onChange={(event) => update({ endTime: event.target.value })}>{timeOptions.slice(1).map((time) => <option key={time}>{time}</option>)}</select></div></div>
      <fieldset className={styles.weekdayPicker}><legend>공개할 요일</legend>{["월", "화", "수", "목", "금"].map((day, index) => <label key={day}><input type="checkbox" checked={options.weekdays.includes(index + 1)} onChange={(event) => update({ weekdays: event.target.checked ? [...options.weekdays, index + 1] : options.weekdays.filter((d) => d !== index + 1) })} /><span>{day}</span></label>)}</fieldset>
      {candidates && <section className={styles.candidatePicker} aria-label="공개할 후보 선택"><div className={styles.sectionHeading}><h3>공개할 후보 · {selected.length}개 선택</h3><button type="button" className={styles.secondary} onClick={() => { setPreview(""); setCandidates(null); setSelected([]); }}>후보 다시 조회</button></div>
        {candidates.length < 5 && <p className={styles.muted}>조건에 맞는 후보가 {candidates.length}개입니다.{candidates.length < 2 ? " 범위를 넓히거나 미팅 길이를 줄여 주세요." : " 이 중 2개 이상 선택할 수 있어요."}</p>}
        <div className={styles.candidateChoices}>{candidates.map((slot) => <label key={slot.start} className={selected.includes(slot.start) ? styles.candidateSelected : undefined}><input type="checkbox" checked={selected.includes(slot.start)} onChange={(event) => setSelected(event.target.checked ? [...selected, slot.start] : selected.filter((start) => start !== slot.start))} /><span><strong>{shortDate(slot.start)}</strong><span>{clockTime(slot.start)}–{clockTime(slot.end)} · {options.duration}분</span></span></label>)}</div>
        <p className={styles.muted}>선택한 시간만 링크에 공개합니다. 아직 캘린더에 예약되지는 않으며, 요청을 수락할 때 일정을 등록해요.</p>
      </section>}
    </fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>취소</button><button className={styles.primary} type="submit" disabled={busy || !name.trim() || (!!preview && selected.length < 2)}>{busy ? "캘린더 확인 중…" : preview ? `${selected.length}개 시간으로 링크 만들기` : "후보 5개 추천받기"}</button></div>
  </form>;
}

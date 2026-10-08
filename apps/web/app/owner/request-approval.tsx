// AI-generated with OpenAI Codex, 2026-10-05.
"use client";
import { useState } from "react";
import { readJsonResponse } from "@/lib/client-json";
import { clockTime, shortDate } from "./calendar-view";
import type { TimeWindow } from "@/lib/availability";
import styles from "./owner.module.css";

export type MeetingRequest = { id: string; request_mode: 'google' | 'manual'; requester_name: string; requester_email: string; purpose: string; created_at: string; duration_minutes: number; location: string; candidate_slots: Array<TimeWindow & { label: string; reason: string }>; status: string; confirmed_start: string | null; confirmed_end: string | null; google_event_url: string | null };

export default function RequestApproval({ request, canWrite, onChange, onBusy, sharedBusy }: { request: MeetingRequest; canWrite: boolean; onChange: () => Promise<void>; onBusy: (busy: boolean) => void; sharedBusy: boolean }) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState(false);
  async function approve() {
    setBusy(true); onBusy(true); setError("");
    try {
      const response = await fetch(`/api/requests/${request.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: request.status === "confirming" ? request.confirmed_start : selected }) });
      if (response.status === 403) setReconnect(true);
      await readJsonResponse(response, "일정을 등록하지 못했습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "일정을 등록하지 못했습니다."); }
    finally { await onChange(); setBusy(false); onBusy(false); }
  }
  const needsConnection = !canWrite || reconnect;
  return <li className={styles.approvalCard}>
    <strong>{request.requester_name}</strong><span>{request.requester_email}</span><p>{request.purpose} · {request.duration_minutes}분 · {request.location || "장소 미정"}</p>
    {request.request_mode === "manual" && <p className={styles.connectionNotice}>수동 요청 · 요청자가 직접 고른 시간입니다. 요청자 캘린더와 이메일 소유 여부는 확인하지 않았습니다.</p>}
    {request.status === "approved" ? <div className={styles.notice}><strong>수락 완료 · Google 일정 등록</strong><p>{request.confirmed_start && shortDate(request.confirmed_start)} {request.confirmed_start && clockTime(request.confirmed_start)}–{request.confirmed_end && clockTime(request.confirmed_end)}</p><p>Google에 요청자 초대 알림 발송을 요청했습니다.</p>{request.google_event_url && <a target="_blank" rel="noreferrer" href={request.google_event_url}>Google Calendar에서 보기 ↗</a>}</div> : !["needs_owner_review", "confirming"].includes(request.status) ? <p className={styles.muted}>{request.status === "calendar_conflict" ? "등록된 일정이 Google에서 변경 또는 삭제되어 확인이 필요합니다. 자동으로 다시 만들지 않습니다." : "종료된 요청입니다."}</p> : <>
      {request.status === "confirming" ? <p className={styles.muted}>등록 결과를 확인해야 합니다. 같은 시간으로만 재시도하며 이미 만들어진 일정을 다시 생성하지 않습니다.</p> : <fieldset disabled={busy} className={styles.approvalChoices}><legend>수락할 시간 선택</legend>{(request.candidate_slots ?? []).map((slot) => <label key={slot.start}><input type="radio" name={`slot-${request.id}`} value={slot.start} checked={selected === slot.start} onChange={() => setSelected(slot.start)} /><span>{shortDate(slot.start)}<br />{clockTime(slot.start)}–{clockTime(slot.end)}</span></label>)}</fieldset>}
      {needsConnection ? <div className={styles.connectionNotice}><p>Google 일정 등록 권한을 한 번 연결해 주세요.</p><a className={styles.secondary} href="/api/auth/google/start?role=owner&reconnect=1">일정 등록 권한 연결</a><p>현재 연결한 호스트 Google 계정을 선택해 주세요.</p></div> : <><p className={styles.muted}>수락하면 내 캘린더에 등록하고 위 이메일로 Google 일정 초대를 보냅니다. 상대방의 설정에 따라 초대 수락이 필요할 수 있어요.</p><button className={styles.primary} disabled={busy || sharedBusy || (request.status !== "confirming" && !selected)} onClick={() => void approve()}>{busy ? "일정 등록 중…" : request.status === "confirming" ? "등록 결과 확인 / 재시도" : "수락하고 초대 보내기"}</button></>}
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </li>;
}

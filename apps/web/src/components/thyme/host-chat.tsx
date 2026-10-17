// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { request } from "@/components/api";
import { useMutationOperation } from "@/components/hooks/useMutationOperation";
import { days, timeText } from "@/components/onboarding/draftReducer";
import { preferenceRows } from "@/components/onboarding/ProfileSummary";
import type { ApiResult } from "@/contracts/common";
import { profileDraftViewSchema, profileViewSchema, type ProfileDraftView } from "@/contracts/profile";
import { Brand, PRODUCT_NAME } from "./brand";
import { CopyButton } from "./copy-button";
import type { HostSetup } from "./host-onboarding";
import { AccountIcon, Avatar, SendIcon } from "./icons";

// The web chat with Thyme. It is the profile-draft conversation of /api/profile-drafts: the host's lines go to
// the draft's turns, Thyme's replies are the ones the server stored, and the draft is confirmed from here.
// Lines Thyme says around them (greeting, the proposal before confirming, the link after) are drawn here and not stored.
// Messages scroll inside a fixed window and the composer stays put.

type Entry =
  | { id: string; who: "thyme" | "me"; kind: "text"; text: string }
  | { id: string; who: "thyme"; kind: "typing" }
  | { id: string; who: "thyme"; kind: "link" };
type Group = { id: string; who: "thyme" | "me"; entries: Entry[] };
type Reply = { label: string; act: () => void };
type Notice = { text: string; recover?: () => void };

const FIRST_QUESTION = "보통 어떤 요일, 몇 시에 근무하세요? 고정 근무시간이 없어도 괜찮아요.";

// Weekly windows as one line, Monday first, days with the same hours joined: "월·화·수 13:00–18:00 / 토 10:00–12:00".
function windowsText(windows: ProfileDraftView["values"]["meetingWindows"]): string {
  const byDay = new Map<number, string[]>();
  for (const w of [...windows].sort((a, b) => (a.weekday + 6) % 7 - (b.weekday + 6) % 7 || a.startMin - b.startMin)) {
    byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), `${timeText(w.startMin)}–${timeText(w.endMin)}`]);
  }
  const byHours = new Map<string, number[]>();
  for (const [day, hours] of byDay) byHours.set(hours.join(", "), [...(byHours.get(hours.join(", ")) ?? []), day]);
  return [...byHours].map(([hours, ds]) => `${ds.map((d) => days[d]).join("·")} ${hours}`).join(" / ");
}

function proposal(values: ProfileDraftView["values"]): string {
  return [
    `근무: ${values.work.mode === "none" ? "고정 근무시간 없음" : windowsText(values.work.windows)}`,
    `미팅 가능: ${values.meetingWindows.length ? windowsText(values.meetingWindows) : "없음"}`,
    ...preferenceRows(values).filter(([, value]) => value !== "없음" && value !== "선호 없음").map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
}

export function HostChat({ host }: { host: HostSetup }) {
  const [draft, setDraft] = useState(host.draft);
  // Confirmed in this visit, or confirmed before and not being edited.
  const [confirmed, setConfirmed] = useState(host.hasProfile && !host.draft);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [origin, setOrigin] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const create = useMutationOperation<ProfileDraftView>();
  const ai = useMutationOperation<ProfileDraftView>();
  const confirm = useMutationOperation<z.infer<typeof profileViewSchema>>();
  const busy = create.pending || ai.pending || confirm.pending;
  const log = useRef<HTMLDivElement>(null);
  const say = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);

  const active = draft?.status === "active" && !confirmed ? draft : null;
  // An analysis message carries its evidence; once one exists the AI has already read the calendar for this draft.
  const analyzed = !!draft?.messages.some((m) => m.role === "assistant" && !!m.evidenceIds?.length);
  const ready = !!active && Object.values(active.topics).every((t) => t === "confirmed");

  // A failed command either changed nothing (say why), lost the race with another tab (load the latest draft),
  // or ended without a known outcome (offer to check before anything is sent again).
  async function failed(result: ApiResult<unknown>, recover: () => void) {
    if (result.ok) return;
    if (result.error.code === "revision_conflict" || result.error.code === "profile_version_conflict") {
      const latest = await request("GET", "/api/profile-drafts/current", profileDraftViewSchema.nullable());
      if (latest.ok) setDraft(latest.data);
      setNotice({ text: "다른 화면에서 설정이 바뀌어 최신 내용을 불러왔어요. 다시 보내 주세요." });
      return;
    }
    const detail = [result.error.message, ...Object.values(result.error.fieldErrors ?? {}).flat()].join(" ");
    setNotice(result.meta.outcome === "not_applied" ? { text: detail } : { text: detail, recover });
  }

  async function ensureDraft(): Promise<ProfileDraftView | null> {
    if (active) return active;
    const created = (r: ApiResult<ProfileDraftView> | null) => {
      if (!r?.ok) return null;
      setDraft(r.data);
      setConfirmed(false);
      setJustConfirmed(false);
      return r.data;
    };
    const r = await create.run({ method: "POST", url: "/api/profile-drafts", kind: "profile.draft.create", payload: { purpose: host.hasProfile || confirmed ? "edit" : "onboarding" }, schema: profileDraftViewSchema });
    if (r && !r.ok) void failed(r, () => void create.recover().then(created));
    return created(r);
  }

  function answered(r: ApiResult<ProfileDraftView> | null, line?: string) {
    if (!r) return;
    setPending(null);
    if (r.ok) { setDraft(r.data); return; }
    if (line) setText(line);
    void failed(r, () => void ai.recover().then((again) => answered(again)));
  }

  async function send(line: string) {
    if (busy) return;
    setNotice(null);
    setText("");
    setPending(line);
    const d = await ensureDraft();
    if (!d) { setPending(null); setText(line); return; }
    answered(await ai.run({ method: "POST", url: `/api/profile-drafts/${encodeURIComponent(d.draftId)}/turns`, kind: "profile.draft.turn", payload: { expectedRevision: d.revision, text: line }, schema: profileDraftViewSchema }), line);
  }

  async function analyze() {
    if (busy) return;
    setNotice(null);
    const d = await ensureDraft();
    if (!d) return;
    answered(await ai.run({ method: "POST", url: `/api/profile-drafts/${encodeURIComponent(d.draftId)}/analyze`, kind: "profile.draft.analyze", payload: { expectedRevision: d.revision }, schema: profileDraftViewSchema }));
  }

  function saved(r: Awaited<ReturnType<typeof confirm.run>>) {
    if (!r) return;
    if (r.ok) { setConfirmed(true); setJustConfirmed(true); return; }
    void failed(r, () => void confirm.recover().then(saved));
  }

  async function confirmDraft() {
    if (busy || !active) return;
    setNotice(null);
    saved(await confirm.run({ method: "POST", url: `/api/profile-drafts/${encodeURIComponent(active.draftId)}/confirm`, kind: "profile.draft.confirm", payload: { expectedRevision: active.revision, baseProfileVersion: active.baseProfileVersion }, schema: profileViewSchema }));
  }

  async function signOut() {
    await request("POST", "/api/auth/logout", z.object({ loggedOut: z.boolean() }), {});
    location.assign("/");
  }

  // What Thyme says, in order: greeting, the stored conversation, then where the setup stands.
  const entries: Entry[] = [];
  const thyme = (id: string, line: string) => entries.push({ id, who: "thyme", kind: "text", text: line });
  thyme("hello", "안녕하세요, Thyme이에요.");
  if (host.calendar === "imported") thyme("calendar", "Calendar에서 가져온 일정이 있어요. 지난 일정을 분석해 시간을 제안할 수도 있어요.");
  else if (host.calendar === "connected") thyme("calendar", "Calendar가 연결돼 있어요.");
  const messages = draft?.messages ?? [];
  if (host.hasProfile && !messages.length) thyme("profile", "확정한 시간 프로필이 있어요. 바꿀 점이 있으면 말해 주세요.");
  else if (!messages.length) thyme("first", FIRST_QUESTION);
  for (const m of messages) entries.push({ id: m.id, who: m.role === "user" ? "me" : "thyme", kind: "text", text: m.content });
  if (pending !== null) entries.push({ id: "pending", who: "me", kind: "text", text: pending });
  if (busy) entries.push({ id: "typing", who: "thyme", kind: "typing" });
  else if (ready && active) {
    thyme(`proposal-${active.revision}`, proposal(active.values));
    thyme(`ask-${active.revision}`, "이대로 확정할까요?");
  } else if (confirmed) {
    if (justConfirmed) thyme("saved", "저장했어요.");
    thyme("link-lead", "내 예약 링크예요.");
    entries.push({ id: "link", who: "thyme", kind: "link" });
    thyme("link-note", host.hostReady ? "이 링크를 받은 사람은 연락처에 추가되고 미팅을 요청할 수 있어요." : "예약을 받으려면 호스트 설정에서 장소와 미팅 양식을 하나 이상 등록해 주세요.");
  }

  const replies: Reply[] = busy ? [] : [
    ...(host.calendar === "imported" && !analyzed && !confirmed ? [{ label: "지난 일정 분석하기", act: () => void analyze() }] : []),
    ...(ready ? [
      { label: "이 설정으로 확정", act: () => void confirmDraft() },
      { label: "조정할게요", act: () => { setNotice({ text: "바꿀 내용을 적어 보내 주세요." }); say.current?.focus(); } },
    ] : []),
    ...(confirmed ? [host.hostReady
      ? { label: "내 시간 프로필 보기", act: () => location.assign("/settings/availability") }
      : { label: "호스트 설정 열기", act: () => location.assign("/settings/host") }] : []),
  ];

  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last?.who === entry.who) last.entries.push(entry);
    else groups.push({ id: entry.id, who: entry.who, entries: [entry] });
  }

  useEffect(() => {
    setOrigin(location.origin);
    heading.current?.focus({ preventScroll: true });
  }, []);

  // new messages sit at the bottom of the window, like a messenger
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [entries.length]);

  // the account menu closes on Escape or a click outside it
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(event: MouseEvent) {
      if (!(event.target as Element).closest(".account")) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setMenuOpen(false); accountButton.current?.focus(); }
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const line = text.trim();
    if (!line || busy) return;
    void send(line);
  }

  const link = `${origin}/invite/${host.inviteToken}`;
  return (
    <div className="inner" data-screen="chat">
      <header className="top">
        <Brand />
        <div className="peer">
          <Avatar />
          <div><strong>Thyme</strong><span className="sub">{PRODUCT_NAME}</span></div>
        </div>
        <div className="account">
          <button className="account-btn" type="button" ref={accountButton} aria-expanded={menuOpen} aria-controls="account-menu" aria-label="Account" onClick={() => setMenuOpen((open) => !open)}>
            <AccountIcon />
          </button>
          <div className="account-menu" id="account-menu" hidden={!menuOpen}>
            <p className="acct-name">{host.name}<span>{host.demo ? "Demo account" : "Signed in with Google"}</span></p>
            <a className="menu-item" href="/book">Book a meeting</a>
            <a className="menu-item" href="/requests/inbox">Requests</a>
            <a className="menu-item" href="/calendar">My calendar</a>
            <a className="menu-item" href="/settings/host">Settings</a>
            {!host.demo && <button className="menu-item" type="button" onClick={() => void signOut()}>Sign out</button>}
          </div>
        </div>
      </header>
      <main className="chat">
        <h1 className="sr-only" ref={heading} tabIndex={-1}>Your conversation with Thyme</h1>
        <section className="window" aria-labelledby="window-name">
          <div className="window-head">
            <Avatar />
            <div><strong id="window-name">Thyme</strong><span className="sub">Your scheduling assistant</span></div>
          </div>
          <div className="log" ref={log} aria-live="polite">
            {groups.map((group) => (
              <div className={`group ${group.who}`} key={group.id}>
                {group.who === "thyme" && <Avatar />}
                <div className="stack">
                  {group.entries.map((entry) => <ChatBubble entry={entry} link={link} key={entry.id} />)}
                </div>
              </div>
            ))}
          </div>
          <div className="dock">
            {/* suggested replies look like messages you have not sent yet */}
            <div className="suggest" role="group" aria-label="Suggested replies">
              {replies.map((reply) => (
                <button className="ghost" type="button" key={reply.label} lang="ko" onClick={reply.act}>{reply.label}</button>
              ))}
            </div>
            <form className="composer" noValidate onSubmit={submit}>
              <label className="sr-only" htmlFor="say">Message Thyme</label>
              <input
                id="say" ref={say} type="text" autoComplete="off" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={replies.length ? "Message Thyme to say something else" : "Message Thyme"}
              />
              <button className="send" type="submit" aria-label="Send" disabled={busy || !text.trim()}>
                <SendIcon />
              </button>
            </form>
            <p className="dock-help" role="status" lang="ko">
              {notice?.text}
              {notice?.recover && <> <button className="link-btn" type="button" disabled={busy} onClick={notice.recover}>결과 확인</button></>}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

// Thyme's words fade in one after another. Screen readers get the whole sentence at once.
function ChatBubble({ entry, link }: { entry: Entry; link: string }) {
  if (entry.kind === "typing") {
    return <div className="bubble thyme typing" aria-hidden="true"><i /><i /><i /></div>;
  }
  if (entry.kind === "link") {
    return (
      <div className="card">
        <h3>Your link is ready</h3>
        <div className="linkrow">
          <span className="url">{link}</span>
          <CopyButton className="copy" text={link} />
        </div>
      </div>
    );
  }
  const rows = entry.text.split("\n");
  if (entry.who === "me") return <p className="bubble me" lang="ko">{rows.map((row, i) => <span className="row" key={i}>{row}</span>)}</p>;
  let word = 0;
  return (
    <p className="bubble thyme" lang="ko">
      {rows.map((row, r) => (
        <span className="row" key={r}>
          {row.split(" ").map((w, i) => (
            <span key={i}>{i > 0 && " "}<span className="w" style={{ animationDelay: `${word++ * 35}ms` }}>{w}</span></span>
          ))}
        </span>
      ))}
    </p>
  );
}

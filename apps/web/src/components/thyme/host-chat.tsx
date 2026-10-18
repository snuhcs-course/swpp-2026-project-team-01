// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { request } from "@/components/api";
import { useMutationOperation } from "@/components/hooks/useMutationOperation";
import type { ApiResult } from "@/contracts/common";
import { hostChatViewSchema, type ChatMessage, type ChatReply, type HostChatView } from "@/contracts/host-chat";
import { Brand, PRODUCT_NAME } from "./brand";
import { COPY, type Copy } from "./copy";
import { CopyButton } from "./copy-button";
import type { HostSetup } from "./host-onboarding";
import { AccountIcon, Avatar, SendIcon } from "./icons";
import { LanguageSelect } from "./language-select";

// The web chat with Thyme. It draws the view /api/host-chat returns (contracts/host-chat.ts) and sends back what
// the host types or picks; what Thyme says and which replies are offered are decided by the server.
// The screen adds only the host's line while it is on its way and the typing dots.
// Messages scroll inside a fixed window and the composer stays put.

type Entry = ChatMessage | { id: string; from: "thyme"; typing: true };
type Group = { id: string; from: "thyme" | "host"; entries: Entry[] };
type Notice = { text: string; recover?: () => void };

export function HostChat({ host, initial }: { host: HostSetup; initial: HostChatView }) {
  const t = COPY[host.locale].chat;
  const [view, setView] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [origin, setOrigin] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const op = useMutationOperation<HostChatView>();
  const busy = op.pending;
  const log = useRef<HTMLDivElement>(null);
  const say = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);

  // A refresh (language change, calendar imported) renders a new first view on the server.
  useEffect(() => setView(initial), [initial]);

  // A failed send either changed nothing (say why), lost the race with another tab (load the latest view),
  // or ended without a known outcome (offer to check; the retry reuses the key, so it is applied once).
  async function failed(result: ApiResult<unknown>) {
    if (result.ok) return;
    if (result.error.code === "revision_conflict" || result.error.code === "profile_version_conflict") {
      const latest = await request("GET", `/api/host-chat?locale=${host.locale}`, hostChatViewSchema);
      if (latest.ok) setView(latest.data);
      setNotice({ text: t.conflict });
      return;
    }
    const detail = [result.error.message, ...Object.values(result.error.fieldErrors ?? {}).flat()].join(" ");
    setNotice(result.meta.outcome === "not_applied" ? { text: detail } : { text: detail, recover: () => void op.recover().then(answered) });
  }

  function answered(r: ApiResult<HostChatView> | null, line?: string) {
    if (!r) return;
    setPending(null);
    if (r.ok) { setView(r.data); return; }
    if (line) setText(line);
    void failed(r);
  }

  async function send(payload: { text: string } | { reply: string }) {
    if (busy) return;
    setNotice(null);
    const line = "text" in payload ? payload.text : undefined;
    if (line !== undefined) { setText(""); setPending(line); }
    answered(await op.run({ method: "POST", url: "/api/host-chat", kind: "host.chat.send", payload: { ...payload, revision: view.revision, locale: host.locale }, schema: hostChatViewSchema }), line);
    say.current?.focus({ preventScroll: true });
  }

  function pick(reply: ChatReply) {
    if (reply.href) location.assign(reply.href);
    else void send({ reply: reply.id });
  }

  async function signOut() {
    await request("POST", "/api/auth/logout", z.object({ loggedOut: z.boolean() }), {});
    location.assign("/");
  }

  const entries: Entry[] = [
    ...view.messages,
    ...(pending !== null ? [{ id: "pending", from: "host" as const, text: pending }] : []),
    ...(busy ? [{ id: "typing", from: "thyme" as const, typing: true as const }] : []),
  ];
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last?.from === entry.from) last.entries.push(entry);
    else groups.push({ id: entry.id, from: entry.from, entries: [entry] });
  }
  const replies = busy ? [] : view.replies;

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
    void send({ text: line });
  }

  return (
    <div className="inner" data-screen="chat">
      <header className="top">
        <Brand />
        <div className="peer">
          <Avatar />
          <div><strong>Thyme</strong><span className="sub">{PRODUCT_NAME}</span></div>
        </div>
        <div className="top-actions">
          <LanguageSelect locale={host.locale} />
          <div className="account">
            <button className="account-btn" type="button" ref={accountButton} aria-expanded={menuOpen} aria-controls="account-menu" aria-label={t.account} onClick={() => setMenuOpen((open) => !open)}>
              <AccountIcon />
            </button>
            <div className="account-menu" id="account-menu" hidden={!menuOpen}>
              <p className="acct-name">{host.name}<span>{host.demo ? t.demo : t.google}</span></p>
              <a className="menu-item" href="/book">{t.menu.book}</a>
              <a className="menu-item" href="/requests/inbox">{t.menu.requests}</a>
              <a className="menu-item" href="/calendar">{t.menu.calendar}</a>
              <a className="menu-item" href="/settings/host">{t.menu.settings}</a>
              {!host.demo && <button className="menu-item" type="button" onClick={() => void signOut()}>{t.menu.signOut}</button>}
            </div>
          </div>
        </div>
      </header>
      <main className="chat">
        <h1 className="sr-only" ref={heading} tabIndex={-1}>{t.heading}</h1>
        <section className="window" aria-labelledby="window-name">
          <div className="window-head">
            <Avatar />
            <div><strong id="window-name">Thyme</strong><span className="sub">{t.windowSub}</span></div>
          </div>
          <div className="log" ref={log} aria-live="polite">
            {groups.map((group) => (
              <div className={`group ${group.from === "host" ? "me" : "thyme"}`} key={group.id}>
                {group.from === "thyme" && <Avatar />}
                <div className="stack">
                  {group.entries.map((entry) => <ChatBubble entry={entry} origin={origin} copy={COPY[host.locale]} key={entry.id} />)}
                </div>
              </div>
            ))}
          </div>
          <div className="dock">
            {/* suggested replies look like messages you have not sent yet */}
            <div className="suggest" role="group" aria-label={t.suggestions}>
              {replies.map((reply) => (
                <button className="ghost" type="button" key={reply.id} onClick={() => pick(reply)}>{reply.label}</button>
              ))}
            </div>
            <form className="composer" noValidate onSubmit={submit}>
              <label className="sr-only" htmlFor="say">{t.say}</label>
              <input
                id="say" ref={say} type="text" autoComplete="off" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={replies.length ? t.sayElse : t.say}
              />
              <button className="send" type="submit" aria-label={t.send} disabled={busy || !text.trim()}>
                <SendIcon />
              </button>
            </form>
            <p className="dock-help" role="status">
              {notice?.text}
              {notice?.recover && <> <button className="link-btn" type="button" disabled={busy} onClick={notice.recover}>{t.recover}</button></>}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

// Thyme's words fade in one after another. Screen readers get the whole sentence at once.
function ChatBubble({ entry, origin, copy }: { entry: Entry; origin: string; copy: Copy }) {
  if ("typing" in entry) {
    return <div className="bubble thyme typing" aria-hidden="true"><i /><i /><i /></div>;
  }
  const card = entry.card && <LinkCard url={`${origin}${entry.card.path}`} copy={copy} />;
  if (!entry.text) return card ?? null;
  const rows = entry.text.split("\n");
  if (entry.from === "host") return <p className="bubble me">{rows.map((row, i) => <span className="row" key={i}>{row}</span>)}</p>;
  let word = 0;
  return (
    <>
      <p className="bubble thyme">
        {rows.map((row, r) => (
          <span className="row" key={r}>
            {row.split(" ").map((w, i) => (
              <span key={i}>{i > 0 && " "}<span className="w" style={{ animationDelay: `${word++ * 35}ms` }}>{w}</span></span>
            ))}
          </span>
        ))}
      </p>
      {card}
    </>
  );
}

function LinkCard({ url, copy }: { url: string; copy: Copy }) {
  return (
    <div className="card">
      <h3>{copy.chat.linkReady}</h3>
      <div className="linkrow">
        <span className="url">{url}</span>
        <CopyButton className="copy" text={url} labels={copy.copy} />
      </div>
    </div>
  );
}

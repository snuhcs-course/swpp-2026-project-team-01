"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./chrome";
import { COPY, type ExampleRow, type Locale } from "./copy";
import { GoogleLogo } from "./icons";

// The landing's interactive parts: the Google start with its Calendar box, the agent section and the live
// example conversation.

// Sign-in always returns to /app. With the Calendar box checked, the same Google consent also grants Calendar
// access (main's default); unchecked, it asks for identity only, and Calendar is connected later in setup.
// The iMessage start's handoff screen reuses it.
export function GoogleStart({ locale }: { readonly locale: Locale }) {
  const t = COPY[locale].landing;
  const [calendar, setCalendar] = useState(true);
  return (
    <>
      <a className="gbtn" href={calendar ? "/auth/sign-in" : "/auth/sign-in?calendar=0"}>
        <GoogleLogo />
        <span>{t.google}</span>
      </a>
      <label className="check" htmlFor="cal">
        <input checked={calendar} id="cal" onChange={(event) => setCalendar(event.target.checked)} type="checkbox" />
        <span>
          {t.calendar}
          <small>{t.calendarNote}</small>
        </span>
      </label>
    </>
  );
}

// Second way in: one line the host pastes into the AI agent they already use. It is also the landing's visible
// agent section, linking /SKILL.md (public-agent-entry: entry discovery).
export function AgentSection({ locale }: { readonly locale: Locale }) {
  const t = COPY[locale];
  const body = useRef<HTMLElement>(null);
  return (
    <section aria-label={t.landing.agentRegion} className="ld-agent" id="agent">
      <div className="ld-agent-inner">
        <div className="ld-agent-say">
          <h2>{t.landing.agentOr}</h2>
          <p>{t.landing.agentNote}</p>
        </div>
        <div className="ld-agent-do">
          <div className="ld-prompt">
            <code aria-label={t.landing.agentLabel} ref={body} tabIndex={0}>
              {t.landing.agentPrompt}
            </code>
            <CopyButton className="ld-copy" fallbackTarget={body} labels={t.copy} text={t.landing.agentPrompt} />
          </div>
          <p className="ld-agent-doc">
            {t.landing.agentDoc}{" "}
            <a href="/SKILL.md">
              <code>/SKILL.md</code>
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

// How long a line stays before the next one arrives: enough to read it.
function readTime(rows: readonly ExampleRow[]) {
  const length = rows.reduce((sum, row) => sum + (typeof row === "string" ? row.length : row.name.length + row.rest.length), 0);
  return Math.min(2600, 700 + length * 22);
}

// Example conversations with Thyme, each under a line naming what it shows, played one line at a time: Thyme's lines come after a typing mark, the host's
// after a pause, and the next thread follows a few seconds after the last line. It holds still while hovered,
// focused or off screen; with reduced motion every thread shows whole and only the marks below change it. The
// server renders each thread's first line. All names, companies and numbers are made up.
export function LiveThread({ locale }: { readonly locale: Locale }) {
  const ex = COPY[locale].examples;
  const threads = ex.threads;
  const box = useRef<HTMLElement>(null);
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(1);
  const [typing, setTyping] = useState(false);
  const [held, setHeld] = useState(false);
  const [away, setAway] = useState(false);
  const [still, setStill] = useState(false);
  const thread = threads[at]!;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update();
    query.addEventListener("change", update);
    const seen = new IntersectionObserver(([entry]) => setAway(!entry!.isIntersecting));
    seen.observe(box.current!);
    return () => {
      query.removeEventListener("change", update);
      seen.disconnect();
    };
  }, []);

  useEffect(() => {
    if (still || held || away) return;
    const lines = thread.lines;
    let typed: ReturnType<typeof setTimeout> | undefined;
    const wait = setTimeout(
      () => {
        if (shown >= lines.length) {
          // the next thread opens on its first line, so the page is never empty
          setAt((a) => (a + 1) % threads.length);
          setShown(1);
        } else if (lines[shown]!.who === "thyme") {
          setTyping(true);
          typed = setTimeout(() => {
            setTyping(false);
            setShown((s) => s + 1);
          }, 1100);
        } else {
          setShown((s) => s + 1);
        }
      },
      shown >= lines.length ? 4200 : readTime(lines[shown - 1]!.rows),
    );
    return () => {
      clearTimeout(wait);
      clearTimeout(typed);
      setTyping(false);
    };
  }, [at, shown, still, held, away, thread, threads.length]);

  function jump(i: number) {
    setAt(i);
    setShown(threads[i]!.lines.length);
  }

  const visible = still ? thread.lines.length : shown;
  return (
    <figure
      aria-label={ex.label}
      className="ld-live"
      onBlur={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      ref={box}
    >
      <figcaption className="ld-caption" key={`caption-${at}`}>
        {ex.captions[at]}
      </figcaption>
      <div className="ld-live-head">
        <span aria-hidden="true" className="ld-avatar">
          T
        </span>
        <span className="ld-who">
          <strong>Thyme</strong>
          <span>{ex.channel}</span>
        </span>
        {thread.tag ? <span className="ld-live-tag">{thread.tag}</span> : null}
      </div>
      <ol className="ld-msgs" key={at}>
        <li className="ld-stamp">{thread.stamp}</li>
        {thread.lines.slice(0, visible).map((line, j) => (
          <li className={`ld-b ${line.who}`} key={j}>
            <Lines rows={line.rows} />
          </li>
        ))}
        {typing ? (
          <li aria-hidden="true" className="ld-b thyme ld-typing">
            <span />
            <span />
            <span />
          </li>
        ) : null}
      </ol>
      <div aria-label={ex.choose} className="ld-ticks" role="group">
        {threads.map((_, i) => (
          <button aria-current={i === at ? "true" : undefined} aria-label={ex.dot(i + 1, threads.length)} key={i} onClick={() => jump(i)} type="button">
            <span />
          </button>
        ))}
      </div>
    </figure>
  );
}

// A bubble's rows: one plain line, or several, some a bulleted line that starts with a bold name.
function Lines({ rows }: { readonly rows: readonly ExampleRow[] }) {
  if (rows.length === 1) return <Row row={rows[0]!} />;
  return (
    <>
      {rows.map((row, k) => (
        <span className="ld-row" key={k}>
          <Row row={row} />
        </span>
      ))}
    </>
  );
}

function Row({ row }: { readonly row: ExampleRow }) {
  return typeof row === "string" ? (
    <>{row}</>
  ) : (
    <>
      • <b>{row.name}</b>
      {row.rest}
    </>
  );
}

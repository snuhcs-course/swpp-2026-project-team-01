"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./chrome";
import { COPY, type ExampleRow, type Locale } from "./copy";
import { Avatar, Chevron, GoogleLogo } from "./icons";

// The landing's interactive parts, from the landing redesign's components/thyme: the Google start with its
// Calendar box, the agent prompt and the example threads.

// Sign-in always returns to /app. With the Calendar box checked, the same Google consent also grants Calendar
// access (main's default); unchecked, it asks for identity only, and Calendar is connected later in setup.
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

// Second way in: one line the host pastes into the AI agent they already use. It reads like a code block and
// scrolls inside its box once it passes about eight lines. It is also the landing's visible agent section,
// linking /SKILL.md (public-agent-entry: entry discovery).
export function AgentPrompt({ locale }: { readonly locale: Locale }) {
  const t = COPY[locale];
  const body = useRef<HTMLPreElement>(null);
  return (
    <section aria-label={t.landing.agentRegion} className="agent-start">
      <p className="or">{t.landing.agentOr}</p>
      <div className="prompt">
        <div className="prompt-head">
          <span className="prompt-label">prompt</span>
          <CopyButton className="prompt-copy" fallbackTarget={body} labels={t.copy} text={t.landing.agentPrompt} />
        </div>
        <pre aria-label={t.landing.agentLabel} className="prompt-body" ref={body} tabIndex={0}>
          {t.landing.agentPrompt}
        </pre>
      </div>
      <p className="agent-note">
        {t.landing.agentNote} {t.landing.agentDoc} <a href="/SKILL.md">/SKILL.md</a>
      </p>
    </section>
  );
}

// A tap in the right strip of the row (where the next card peeks in) goes forward, the left strip goes back.
const EDGE = 0.15;

// Example conversations with Thyme. All names, companies and numbers are made up. PC shows the last thread
// only; at phone width every thread is a card that swipes sideways.
export function ExampleCards({ locale }: { readonly locale: Locale }) {
  const copy = COPY[locale].examples;
  const threads = copy.threads;
  const cards = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const last = threads.length - 1;

  function slideLeft(i: number) {
    const row = cards.current!;
    const slide = row.children[i] as HTMLElement;
    return slide.offsetLeft - parseFloat(getComputedStyle(row).paddingLeft);
  }
  function show(i: number) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cards.current!.scrollTo({ behavior: reduced ? "auto" : "smooth", left: slideLeft(i) });
  }

  useEffect(() => {
    const row = cards.current!;
    let frame = 0;
    function mark() {
      let nearest = 0;
      for (let i = 1; i <= last; i += 1) {
        if (Math.abs(slideLeft(i) - row.scrollLeft) < Math.abs(slideLeft(nearest) - row.scrollLeft)) nearest = i;
      }
      // The last card can't reach the left edge, so the end of the scroll counts as the last card.
      if (row.scrollLeft >= row.scrollWidth - row.clientWidth - 2) nearest = last;
      setCurrent(nearest);
    }
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(mark);
    }
    row.addEventListener("scroll", onScroll);
    return () => {
      row.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [last]);

  // A swipe makes no click, so this only reacts to taps.
  function onRowClick(event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    if (x > 1 - EDGE && current < last) show(current + 1);
    else if (x < EDGE && current > 0) show(current - 1);
  }

  return (
    <figure className="scene">
      <div className="cards-wrap">
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- edge taps are a shortcut; the dots below are the keyboard way */}
        <div aria-label={copy.label} aria-roledescription="carousel" className="cards" onClick={onRowClick} ref={cards} role="region" tabIndex={0}>
          {threads.map((thread, i) => (
            <div aria-label={copy.slide(i + 1, threads.length)} aria-roledescription="slide" className={thread.alt ? "thread alt" : "thread"} key={i} role="group">
              <div className="thread-head">
                <Avatar />
                <div>
                  <strong>Thyme</strong>
                  <span className="sub">{copy.channel}</span>
                </div>
                {thread.tag ? <span className="thread-tag">{thread.tag}</span> : null}
              </div>
              <ol className="msgs">
                <li className="stamp">{thread.stamp}</li>
                {thread.lines.map((line, j) => (
                  <li className={`bubble ${line.who}${line.more ? " more" : ""}`} key={j}>
                    {line.rows.length === 1 ? (
                      <Row row={line.rows[0]!} />
                    ) : (
                      line.rows.map((row, k) => (
                        <span className="row" key={k}>
                          <Row row={row} />
                        </span>
                      ))
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {/* bare marks only; they take no taps, so a swipe that starts on them still scrolls the row */}
        <span aria-hidden="true" className="card-arrow prev" hidden={current === 0}>
          <Chevron direction="prev" />
        </span>
        <span aria-hidden="true" className="card-arrow next" hidden={current === last}>
          <Chevron direction="next" />
        </span>
      </div>
      <div aria-label={copy.choose} className="card-dots" role="group">
        {threads.map((_, i) => (
          <button aria-current={i === current ? "true" : undefined} aria-label={copy.dot(i + 1, threads.length)} key={i} onClick={() => show(i)} type="button" />
        ))}
      </div>
    </figure>
  );
}

// A plain line, or a bulleted line that starts with a bold name.
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

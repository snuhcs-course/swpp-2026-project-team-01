// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/contracts/profile";
import { COPY, type ExampleRow } from "./copy";
import { Avatar, Chevron } from "./icons";

// Example conversations with Thyme, from copy.ts. All names, companies and numbers are made up.
// PC shows the last thread only; at phone width every thread is a card that swipes sideways.

// A tap in the right strip of the row (where the next card peeks in) goes forward, the left strip goes back.
const EDGE = 0.15;

// It takes the locale, not the copy: the copy holds functions, which cannot cross from the server page.
export function ExampleCards({ locale }: { locale: Locale }) {
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
    cards.current!.scrollTo({ left: slideLeft(i), behavior: reduced ? "auto" : "smooth" });
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
        <div className="cards" ref={cards} role="region" aria-roledescription="carousel" aria-label={copy.label} tabIndex={0} onClick={onRowClick}>
          {threads.map((thread, i) => (
            <div className={thread.alt ? "thread alt" : "thread"} role="group" aria-roledescription="slide" aria-label={copy.slide(i + 1, threads.length)} key={i}>
              <div className="thread-head">
                <Avatar />
                <div><strong>Thyme</strong><span className="sub">{copy.channel}</span></div>
                {thread.tag && <span className="thread-tag">{thread.tag}</span>}
              </div>
              <ol className="msgs">
                <li className="stamp">{thread.stamp}</li>
                {thread.lines.map((line, j) => (
                  <li className={`bubble ${line.who}${line.more ? " more" : ""}`} key={j}>
                    {line.rows.length === 1 ? <Row row={line.rows[0]} /> : line.rows.map((row, k) => <span className="row" key={k}><Row row={row} /></span>)}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {/* bare marks only; they take no taps, so a swipe that starts on them still scrolls the row */}
        <span className="card-arrow prev" aria-hidden="true" hidden={current === 0}><Chevron direction="prev" /></span>
        <span className="card-arrow next" aria-hidden="true" hidden={current === last}><Chevron direction="next" /></span>
      </div>
      <div className="card-dots" role="group" aria-label={copy.choose}>
        {threads.map((_, i) => (
          <button type="button" aria-label={copy.dot(i + 1, threads.length)} aria-current={i === current ? "true" : undefined} onClick={() => show(i)} key={i} />
        ))}
      </div>
    </figure>
  );
}

// A plain line, or a bulleted line that starts with a bold name.
function Row({ row }: { row: ExampleRow }) {
  return typeof row === "string" ? <>{row}</> : <>• <b>{row.name}</b>{row.rest}</>;
}

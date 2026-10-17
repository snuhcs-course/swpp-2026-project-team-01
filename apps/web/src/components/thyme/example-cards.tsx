// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16
"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, Chevron } from "./icons";

// Example conversations with Thyme. All names, companies and numbers are made up.
// PC shows the last thread only; at phone width every thread is a card that swipes sideways.
type Line = { who: "thyme" | "me"; rows: React.ReactNode[]; more?: boolean };
type Thread = { tag?: string; stamp: string; lines: Line[]; alt: boolean };

const THREADS: Thread[] = [
  {
    tag: "During setup", stamp: "Today 9:02 AM", alt: true,
    lines: [
      { who: "thyme", rows: ["I read the last 8 weeks of your calendar.", "• Meetings land Tue to Thu, 1 to 5 PM", "• Mornings stay clear", "• Fridays end by 3:00 PM"] },
      { who: "thyme", rows: ["I'll offer people those hours. OK?"] },
      { who: "me", rows: ["Perfect."] },
    ],
  },
  {
    tag: "During setup", stamp: "Today 9:04 AM", alt: true,
    lines: [
      { who: "thyme", rows: ["Your Wednesdays run back to back. 5 of the last 6 had no break after 2 PM."] },
      { who: "thyme", rows: ["Keep 15 minutes free between meetings?"] },
      { who: "me", rows: ["Yes please."] },
      { who: "thyme", rows: ["Done. Wednesdays get a breather."] },
    ],
  },
  {
    tag: "Anytime", stamp: "Yesterday 6:40 PM", alt: true,
    lines: [
      { who: "me", rows: ["By the way, who is Daniel Lee?"] },
      { who: "thyme", rows: ["Daniel is a partner at Lumen Ventures. You met for coffee on Sep 3 and had a call on Oct 1."] },
      { who: "me", rows: ["Find us a time next week."] },
      { who: "thyme", rows: ["Asking him now."] },
    ],
  },
  {
    stamp: "Today 8:30 AM", alt: false,
    lines: [
      { who: "thyme", rows: ["Two requests want Thu 3:00 PM.", <>• <b>Jisoo Kim</b>, investor → Thu 3:00 PM</>, <>• <b>Minho Park</b>, coffee → Fri 10:00 AM</>, "Investors come first. OK?"] },
      { who: "me", rows: ["Who's Minho again?"], more: true },
      { who: "thyme", rows: ["A PM at a robotics startup. You met at demo day in May. He wants hiring advice."], more: true },
      { who: "me", rows: ["OK, go ahead."] },
      { who: "thyme", rows: ["Jisoo is booked. I'll text you when Minho picks a time."] },
    ],
  },
];

// A tap in the right strip of the row (where the next card peeks in) goes forward, the left strip goes back.
const EDGE = 0.15;

export function ExampleCards() {
  const cards = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const last = THREADS.length - 1;

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
        <div className="cards" ref={cards} role="region" aria-roledescription="carousel" aria-label="Example conversations with Thyme" tabIndex={0} onClick={onRowClick}>
          {THREADS.map((thread, i) => (
            <div className={thread.alt ? "thread alt" : "thread"} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${THREADS.length}`} key={i}>
              <div className="thread-head">
                <Avatar />
                <div><strong>Thyme</strong><span className="sub">Text message</span></div>
                {thread.tag && <span className="thread-tag">{thread.tag}</span>}
              </div>
              <ol className="msgs">
                <li className="stamp">{thread.stamp}</li>
                {thread.lines.map((line, j) => (
                  <li className={`bubble ${line.who}${line.more ? " more" : ""}`} key={j}>
                    {line.rows.length === 1 ? line.rows[0] : line.rows.map((row, k) => <span className="row" key={k}>{row}</span>)}
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
      <div className="card-dots" role="group" aria-label="Choose an example">
        {THREADS.map((_, i) => (
          <button type="button" aria-label={`Example ${i + 1} of ${THREADS.length}`} aria-current={i === current ? "true" : undefined} onClick={() => show(i)} key={i} />
        ))}
      </div>
    </figure>
  );
}

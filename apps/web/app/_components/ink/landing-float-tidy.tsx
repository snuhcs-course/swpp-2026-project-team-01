"use client";

import { type ReactNode, useEffect, useRef } from "react";

// The floating cards. On a phone the hero is a pinned scene: the cards lie in a heap on the day's calendar, and the
// first stretch of scrolling (SCATTER px) sends them off in every direction while the headline rises into their
// place. Scroll progress is written to the hero as `--p` (0 to 1). Wider screens, and reduced motion, ignore it.
const SCATTER = 360;

export function ScatterCards({ children }: { readonly children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = box.current!.closest<HTMLElement>(".lg-hero")!;
    const phone = window.matchMedia("(max-width: 600px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    function update() {
      frame = 0;
      const p = phone.matches && !still.matches ? Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / SCATTER)) : 0;
      hero.style.setProperty("--p", p.toFixed(3));
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    phone.addEventListener("change", update);
    still.addEventListener("change", update);
    return () => {
      window.removeEventListener("scroll", onScroll);
      phone.removeEventListener("change", update);
      still.removeEventListener("change", update);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div aria-hidden="true" className="lg-cards" ref={box}>
      {children}
    </div>
  );
}

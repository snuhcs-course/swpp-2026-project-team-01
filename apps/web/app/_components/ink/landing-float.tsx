import type { ReactNode } from "react";
import { Brand, LanguageSelect } from "./chrome";
import { COPY, type Locale } from "./copy";
import { ScatterCards } from "./landing-float-tidy";
import { LiveThread } from "./landing-parts";
import "./landing-float.css";

// The landing's first screen (after Daisy AI and Superpower on supahero.io): the headline centred over a faint
// week of calendar, with pieces of the product around it as glass cards, each a made-up moment of what Thyme does
// (from the example threads and the feature pictures), squared up in two columns: the conversation on the left, its
// outcome on the right. On phones the cards lie on one day's calendar and scatter as the headline rises. The live
// conversation follows as a band.

// Monday 2 November 2026, the week the example times fall in.
const MONDAY = Date.UTC(2026, 10, 2);

export function FloatHero({ locale, start }: { readonly locale: Locale; readonly start: ReactNode }) {
  const copy = COPY[locale];
  const t = copy.landing;
  const f = t.frag;
  const tag = locale === "ko" ? "ko-KR" : "en-US";
  const day = new Intl.DateTimeFormat(tag, {
    timeZone: "UTC",
    weekday: "short",
  });
  const time = new Intl.DateTimeFormat(tag, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const at = (weekday: number, hour: number, minute = 0) => {
    const instant =
      MONDAY + weekday * 86_400_000 + (hour * 60 + minute) * 60_000;
    return `${day.format(instant)} ${time.format(instant)}`;
  };
  const today = copy.examples.threads[3]!;
  const jisoo = today.lines[0]!.rows[1] as { name: string; rest: string };
  const okay = today.lines[3]!.rows[0] as string;

  return (
    <>
      <div className="lg-hero">
        <div className="lg-stage">
          <header className="ld-top lg-top">
            <Brand />
            <div className="ld-actions">
              <LanguageSelect locale={locale} />
              <a className="ld-signin" href="/auth/sign-in">
                {t.signIn}
              </a>
            </div>
          </header>

          <GridWash locale={locale} />
          <ScatterCards>
            <DayGrid locale={locale} />
            <span className="lg-card lg-guest">{f.negotiation[0]!.text}</span>
            <span className="lg-card lg-thyme">{f.negotiation[1]!.text}</span>
            <span className="lg-card lg-travel">
              <b>{f.coffee}</b>
              <span>
                {f.travel(25)} · {f.buffer(10)}
              </span>
            </span>
            <span className="lg-card lg-slots">
              <small>{f.theySee}</small>
              <span>{at(1, 15, 30)}</span>
              <span>{at(2, 16, 30)}</span>
            </span>
            <span className="lg-card lg-proposal">
              <small>{f.proposal}</small>
              <b>{jisoo.name}</b>
              <span>
                {at(3, 15)} · {f.minutes(30)}
              </span>
              <i>{f.approve}</i>
            </span>
            <span className="lg-card lg-account">{f.noAccount}</span>
            <span className="lg-card lg-me">{okay}</span>
          </ScatterCards>

          <main className="lg-pitch">
            <h1>
              {t.headline.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
            <p className="ld-lede">{t.lede}</p>
            <div className="start ld-start lg-start">{start}</div>
            <a className="ld-to-agent" href="#agent">
              {t.agentOr}
              <span aria-hidden="true"> ↓</span>
            </a>
          </main>
        </div>
      </div>

      <div className="ld-page lg-band">
        <LiveThread locale={locale} />
      </div>
    </>
  );
}

// A week of calendar behind the hero: seven day columns under their names, an hour every 72 px with its label,
// a few pale blocks where meetings sit and the "now" line across today. It fades out behind the headline.
const GRID_BLOCKS: readonly (readonly [number, number, number])[] = [
  [0, 1.5, 1],
  [1, 4, 1.5],
  [1, 7.5, 0.75],
  [2, 2, 1],
  [2, 6, 2],
  [3, 1, 0.75],
  [3, 5, 1.25],
  [4, 3, 1.5],
  [4, 8, 1],
  [5, 2.5, 0.75],
  [5, 6.5, 1],
  [6, 4.5, 1.5],
];
function GridWash({ locale }: { readonly locale: Locale }) {
  const tag = locale === "ko" ? "ko-KR" : "en-US";
  const day = new Intl.DateTimeFormat(tag, {
    timeZone: "UTC",
    weekday: "short",
  });
  const hour = new Intl.DateTimeFormat(tag, {
    hour: "numeric",
    timeZone: "UTC",
  });
  const left = 80;
  const top = 120;
  const column = (1440 - left - 40) / 7;
  const row = 72;
  return (
    <svg
      aria-hidden="true"
      className="lg-wash lg-grid"
      preserveAspectRatio="xMidYMin slice"
      viewBox="0 0 1440 900"
    >
      {Array.from({ length: 7 }, (_, i) => (
        <text
          className="lg-grid-day"
          key={`d${i}`}
          x={left + column * i + column / 2}
          y={top - 22}
        >
          {day.format(MONDAY + i * 86_400_000)}
        </text>
      ))}
      {Array.from({ length: 11 }, (_, i) => (
        <g key={`h${i}`}>
          <line
            className="lg-grid-line"
            x1={left}
            x2={1400}
            y1={top + row * i}
            y2={top + row * i}
          />
          <text className="lg-grid-hour" x={left - 14} y={top + row * i + 4}>
            {hour.format(MONDAY + (8 + i) * 3_600_000)}
          </text>
        </g>
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <line
          className="lg-grid-line"
          key={`c${i}`}
          x1={left + column * i}
          x2={left + column * i}
          y1={top - 8}
          y2={top + row * 10}
        />
      ))}
      {GRID_BLOCKS.map(([weekday, start, length]) => (
        <rect
          className="lg-grid-block"
          height={row * length - 6}
          key={`${weekday}-${start}`}
          rx="8"
          width={column - 12}
          x={left + column * weekday + 6}
          y={top + row * start + 3}
        />
      ))}
      <line
        className="lg-grid-now"
        x1={left + column * 5}
        x2={left + column * 6}
        y1={top + row * 6.2}
        y2={top + row * 6.2}
      />
      <circle
        className="lg-grid-dot"
        cx={left + column * 5}
        cy={top + row * 6.2}
        r="5"
      />
    </svg>
  );
}

// Phones: Thursday from noon to 6 PM under the card heap, 60 px an hour.
function DayGrid({ locale }: { readonly locale: Locale }) {
  const hour = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "numeric",
    timeZone: "UTC",
  });
  return (
    <span className="lg-day">
      {Array.from({ length: 7 }, (_, i) => (
        <span className="lg-day-row" key={i} style={{ top: `${i * 60}px` }}>
          <small>{hour.format(MONDAY + (12 + i) * 3_600_000)}</small>
        </span>
      ))}
      <span className="lg-day-busy" style={{ height: "54px", top: "63px" }} />
      <span className="lg-day-busy" style={{ height: "84px", top: "243px" }} />
    </span>
  );
}

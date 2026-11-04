import type { ReactNode } from "react";
import { COPY, type Locale } from "./copy";

// The landing's features: what the service does for the host, each beside a small made-up example of it drawn
// as the product would show it. The examples reuse the example threads' people and hours (Minho's coffee
// request, Tue to Thu 1 to 5 PM, Jisoo's Thursday 3 PM booking). They are pictures, so screen readers get the heading and sentence beside them.

// Thursday 5 November 2026, 06:00 UTC: 3 PM in Seoul and 6 AM in London. Monday 2 November starts the week.
const THURSDAY_3PM_SEOUL = Date.UTC(2026, 10, 5, 6);
const MONDAY = Date.UTC(2026, 10, 2);

function formats(locale: Locale) {
  const tag = locale === "ko" ? "ko-KR" : "en-US";
  const day = new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "short" });
  const time = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const at = (weekday: number, hour: number, minute = 0) => {
    const instant = MONDAY + weekday * 86_400_000 + (hour * 60 + minute) * 60_000;
    return { day: day.format(instant), time: time.format(instant) };
  };
  const zone = (timeZone: string) => {
    const shown = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone, weekday: "short" });
    return shown.format(THURSDAY_3PM_SEOUL);
  };
  return { at, zone };
}

export function Features({ locale }: { readonly locale: Locale }) {
  const t = COPY[locale].landing;
  const fragments = [
    <Negotiate key="negotiate" locale={locale} />,
    <Fits key="fits" locale={locale} />,
    <Private key="private" locale={locale} />,
    <Guests key="guests" locale={locale} />,
    <Approve key="approve" locale={locale} />,
  ];
  return (
    <section aria-labelledby="features-h" className="ld-features">
      <h2 id="features-h">{t.featuresTitle}</h2>
      <ul className="ld-feature-list">
        {t.features.map(([title, body], i) => (
          <li className="ld-feature" key={title}>
            <div className="ld-feature-text">
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
            <div aria-hidden="true" className="ld-board">
              {fragments[i]}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Busy blocks on the host's Tuesday to Thursday, in hours, and the three times a guest is offered instead.
const BUSY = [
  [9.5, 11, 14, 15.5],
  [10, 11.5, 13, 14.5, 15, 16],
  [9, 10.5, 13, 14.5],
] as const;
const OFFERED = [
  [1, 15, 30],
  [2, 16, 30],
  [3, 15, 0],
] as const;

function Private({ locale }: { readonly locale: Locale }) {
  const f = COPY[locale].landing.frag;
  const { at } = formats(locale);
  return (
    <div className="fx fx-private">
      <div className="fx-card">
        <span className="fx-label">{f.yourCalendar}</span>
        <div className="fx-week">
          {BUSY.map((blocks, i) => (
            <div className="fx-day" key={i}>
              <span className="fx-day-name">{at(i + 1, 0).day}</span>
              <div className="fx-day-hours">
                {pairs(blocks).map(([from, to]) => (
                  <i key={from} style={{ height: `${((to - from) / 9) * 100}%`, top: `${((from - 9) / 9) * 100}%` }}>
                    <b />
                    <b />
                  </i>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="fx-arrow">→</span>
      <div className="fx-card fx-theirs">
        <span className="fx-label">{f.theySee}</span>
        <ul>
          {OFFERED.map(([weekday, hour, minute]) => {
            const slot = at(weekday, hour, minute);
            return (
              <li key={`${weekday}-${hour}`}>
                <span>{slot.day}</span> {slot.time}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function pairs(blocks: readonly number[]) {
  const out: [number, number][] = [];
  for (let i = 0; i < blocks.length; i += 2) out.push([blocks[i]!, blocks[i + 1]!]);
  return out;
}

// The guest asks for a time that doesn't work; Thyme offers others without saying why, and the guest picks one.
// Minho is the example threads' coffee request, picking his time.
function Negotiate({ locale }: { readonly locale: Locale }) {
  const copy = COPY[locale];
  const f = copy.landing.frag;
  const minho = copy.examples.threads[3]!.lines[0]!.rows[2] as { name: string; rest: string };
  return (
    <div className="fx fx-talk">
      <div className="fx-card">
        <span className="fx-label">
          {minho.name} · {f.bookingPage}
        </span>
        <ol className="fx-msgs">
          {f.negotiation.map((line) => (
            <li className={`fx-msg ${line.who}`} key={line.text}>
              {line.text}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// One Thursday afternoon, the product requirements' own travel example: a coffee in Yeoksam ends at 2 PM, and
// the next meeting is in Seongsu, 25 minutes away by transit, with 10 minutes of slack. 2:30 PM can't be made;
// 3:00 PM can.
function Fits({ locale }: { readonly locale: Locale }) {
  const f = COPY[locale].landing.frag;
  const { at } = formats(locale);
  const hours = [13, 14, 15, 16];
  const place = (from: number, to: number) => ({ height: `${((to - from) / 3) * 100}%`, top: `${((from - 13) / 3) * 100}%` });
  return (
    <div className="fx fx-fits">
      <div className="fx-card">
        <div className="fx-timeline">
          {hours.map((hour) => (
            <span className="fx-hour" key={hour} style={{ top: `${((hour - 13) / 3) * 100}%` }}>
              {at(3, hour).time}
            </span>
          ))}
          <div className="fx-lane">
            <span className="fx-event" style={place(13, 14)}>
              {f.coffee}
            </span>
            <span className="fx-travel" style={place(14, 14 + 35 / 60)}>
              {f.travel(25)}
              <small>{f.buffer(10)}</small>
            </span>
            <span className="fx-no" style={place(14.5, 15)}>
              <s>{at(3, 14, 30).time}</s> {f.tooTight}
            </span>
            <span className="fx-yes" style={place(15, 16)}>
              <Check />
              <span>
                {at(3, 15).time} · {f.fits}
                <small>{f.place}</small>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Guests({ locale }: { readonly locale: Locale }) {
  const f = COPY[locale].landing.frag;
  const { zone } = formats(locale);
  const ways: [ReactNode, string][] = [
    [<LinkIcon key="link" />, f.bookingPage],
    [<MailIcon key="mail" />, f.email],
    [<AgentIcon key="agent" />, f.agent],
  ];
  return (
    <div className="fx fx-guests">
      <div className="fx-card">
        <span className="fx-badge">{f.noAccount}</span>
        <ul className="fx-ways">
          {ways.map(([icon, label]) => (
            <li key={label}>
              {icon}
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="fx-zones">
        <span>
          <small>{f.seoul}</small>
          {zone("Asia/Seoul")}
        </span>
        <span aria-hidden="true">=</span>
        <span>
          <small>{f.london}</small>
          {zone("Europe/London")}
        </span>
      </div>
    </div>
  );
}

function Approve({ locale }: { readonly locale: Locale }) {
  const copy = COPY[locale];
  const f = copy.landing.frag;
  const { at } = formats(locale);
  const today = copy.examples.threads[3]!;
  const jisoo = today.lines[0]!.rows[1] as { name: string; rest: string };
  const booked = today.lines.at(-1)!.rows[0] as string;
  const slot = at(3, 15);
  return (
    <div className="fx fx-approve">
      <div className="fx-card">
        <span className="fx-label">{f.proposal}</span>
        <strong>{jisoo.name}</strong>
        <span className="fx-role">{jisoo.rest.replace(/^, /, "").split(" → ")[0]}</span>
        <span className="fx-when">
          {slot.day} {slot.time} · {f.minutes(30)} · {f.online}
        </span>
        <span className="fx-buttons">
          <span className="fx-btn on">{f.approve}</span>
          <span className="fx-btn">{f.decline}</span>
        </span>
      </div>
      <span className="fx-bubble">{booked.split(/(?<=\.)\s/)[0]}</span>
    </div>
  );
}

function Check() {
  return (
    <svg fill="none" height="14" viewBox="0 0 16 16" width="14">
      <path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 20 20" width="18">
      <rect height="12" rx="2" stroke="currentColor" strokeWidth="1.6" width="15" x="2.5" y="4" />
      <path d="m3 5.5 7 5 7-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M5 5l2 2M13 13l2 2M15 5l-2 2M7 13l-2 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

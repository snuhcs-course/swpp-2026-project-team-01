import type { MessagingChannel } from "@lib/contracts/messaging-channel";
import { InkStage } from "./chrome";
import { COPY, type Locale } from "./copy";
import { ImessageStart, ImessageStartBlock } from "./imessage-start";
import { Features } from "./landing-features";
import { FloatHero } from "./landing-float";
import { AgentSection, GoogleStart } from "./landing-parts";
import "./landing.css";

// The public landing. The first screen is the headline and the way in over a faint week of calendar, with glass cards
// of what Thyme does around them (landing-float.tsx), then Thyme's example conversations on an ink-blue band, each
// named for what it shows. Then what the service does, the three steps, the agent way in and the footer.
// Two starts: Google first (/), and a messaging app first (/?flow=imessage or /?flow=whatsapp), where the visitor
// sends Thyme the link message before signing in.
export function Landing({ flow, locale }: { readonly flow: MessagingChannel | null; readonly locale: Locale }) {
  const t = COPY[locale].landing;
  const start = flow ? <ImessageStartBlock locale={locale} /> : <GoogleStart locale={locale} />;
  const page = (
    <div className="ld" data-screen="landing">
      <FloatHero locale={locale} start={start} />

      <Features locale={locale} />

      <section aria-labelledby="steps-h" className="ld-steps">
        <h2 id="steps-h">{t.stepsTitle}</h2>
        <ol>
          {t.steps.map(([title, body], i) => (
            <li key={title}>
              <span aria-hidden="true" className="ld-num">
                {i + 1}
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <AgentSection locale={locale} />

      <footer className="ld-foot">
        <p aria-hidden="true" className="ld-giant">
          Find Me a Time
        </p>
        <div className="ld-foot-row">
          <p>{t.tagline}</p>
          <p>© 2026 Find Me a Time. {t.rights}</p>
          <nav aria-label={t.legal} className="ld-legal">
            <a href={locale === "ko" ? "/privacy-policy?lang=ko" : "/privacy-policy"}>{t.privacy}</a>
            <a href={locale === "ko" ? "/terms-of-service?lang=ko" : "/terms-of-service"}>{t.terms}</a>
          </nav>
        </div>
      </footer>
    </div>
  );

  return (
    <InkStage locale={locale}>
      {flow ? (
        <ImessageStart channel={flow} locale={locale}>
          {page}
        </ImessageStart>
      ) : (
        page
      )}
    </InkStage>
  );
}

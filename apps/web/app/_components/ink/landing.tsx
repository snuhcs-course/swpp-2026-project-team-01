import { Brand, InkStage, LanguageSelect } from "./chrome";
import { COPY, type Locale } from "./copy";
import { ImessageStart, ImessageStartBlock } from "./imessage-start";
import { AgentPrompt, ExampleCards, GoogleStart } from "./landing-parts";

// The public landing (from the landing redesign's app/(site)/page.tsx). Two starts: Google first (/), and
// iMessage first (/?flow=imessage), where the visitor sends Thyme the link message before signing in. Both
// offer the agent prompt underneath.
export function Landing({ imessage, locale }: { readonly imessage: boolean; readonly locale: Locale }) {
  const t = COPY[locale].landing;
  const page = (
    <div className="inner" data-screen="landing">
      <header className="top">
        <Brand />
        <div className="top-actions">
          <LanguageSelect locale={locale} />
          <a className="signin" href="/auth/sign-in">
            {t.signIn}
          </a>
        </div>
      </header>

      <main className="hero">
        <div className="pitch">
          <h1>
            {t.headline.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h1>
          <p className="lede">{t.lede}</p>
          <div className="start">
            {imessage ? <ImessageStartBlock locale={locale} /> : <GoogleStart locale={locale} />}
            <AgentPrompt locale={locale} />
          </div>
        </div>
        <ExampleCards locale={locale} />
      </main>

      <section aria-labelledby="steps-h" className="steps">
        <h2 id="steps-h">{t.stepsTitle}</h2>
        <ol>
          {t.steps.map(([title, body]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="foot">
        <p>{t.tagline}</p>
        <p>
          © 2026 Find Me a Time. {t.rights} <a href={t.privacy[1]}>{t.privacy[0]}</a>
        </p>
      </footer>
    </div>
  );

  return <InkStage locale={locale}>{imessage ? <ImessageStart locale={locale}>{page}</ImessageStart> : page}</InkStage>;
}

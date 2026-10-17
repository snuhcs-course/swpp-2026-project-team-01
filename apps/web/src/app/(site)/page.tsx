// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
import { AgentPrompt } from "@/components/thyme/agent-prompt";
import { Brand, PRODUCT_NAME } from "@/components/thyme/brand";
import { COPY } from "@/components/thyme/copy";
import { ExampleCards } from "@/components/thyme/example-cards";
import { GoogleStart, SignInLink } from "@/components/thyme/google-start";
import { LanguageSelect } from "@/components/thyme/language-select";
import { readServerConfig } from "@/server/config";
import { siteLocale } from "./locale";

// P01, the public landing. Both sign-in entries start Google sign-in; demo mode skips it.
export default async function Landing() {
  // A signed-in host signs in again too: that is where the Calendar box takes effect.
  const direct = readServerConfig().mode === "demo";
  const locale = await siteLocale();
  const t = COPY[locale];
  return (
    <div className="inner" data-screen="landing">
      <header className="top">
        <Brand />
        <div className="top-actions">
          <LanguageSelect locale={locale} />
          <SignInLink direct={direct} copy={t.landing} />
        </div>
      </header>

      <main className="hero">
        <div className="pitch">
          <h1>{t.landing.headline.map((line) => <span key={line}>{line}</span>)}</h1>
          <p className="lede">{t.landing.lede}</p>
          <div className="start">
            <GoogleStart direct={direct} copy={t.landing} />
            <AgentPrompt copy={t.landing} labels={t.copy} />
          </div>
          <p className="guest">{t.landing.guest} <a href="#">{t.landing.resume}</a></p>
        </div>
        <ExampleCards locale={locale} />
      </main>

      <section className="steps" aria-labelledby="steps-h">
        <h2 id="steps-h">{t.landing.stepsTitle}</h2>
        <ol>
          {t.landing.steps.map(([title, body]) => <li key={title}><h3>{title}</h3><p>{body}</p></li>)}
        </ol>
      </section>

      <footer className="foot">
        <p>{t.landing.tagline}</p>
        <div className="legal">
          <nav className="legal-links" aria-label={t.landing.legal}><a href="#">{t.landing.privacy}</a><a href="#">{t.landing.terms}</a></nav>
          <p>© 2026 {PRODUCT_NAME}. {t.landing.rights}</p>
        </div>
      </footer>
    </div>
  );
}

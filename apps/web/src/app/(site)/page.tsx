// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
import { DomainError } from "@/contracts/common";
import { AgentPrompt } from "@/components/thyme/agent-prompt";
import { Brand, PRODUCT_NAME } from "@/components/thyme/brand";
import { ExampleCards } from "@/components/thyme/example-cards";
import { GoogleStart, SignInLink } from "@/components/thyme/google-start";
import { readServerConfig } from "@/server/config";
import { requireActor } from "@/server/session";

// P01, the public landing. Both sign-in entries start Google sign-in; demo mode and a signed-in host skip it.
export default async function Landing() {
  const signedIn = await requireActor().then(() => true, (e) => { if (e instanceof DomainError && e.code === "unauthenticated") return false; throw e; });
  const direct = readServerConfig().mode === "demo" || signedIn;
  return (
    <div className="inner" data-screen="landing">
      <header className="top">
        <Brand />
        <SignInLink direct={direct} />
      </header>

      <main className="hero">
        <div className="pitch">
          <h1><span>Send one link.</span><span>Thyme finds the time.</span><span>All you need is to chat.</span></h1>
          <p className="lede">Setting up a meeting is tiring, isn&apos;t it? Send anyone your link without showing your calendar. Thyme works out the time with them and texts you the plan. You just reply back.</p>
          <div className="start">
            <GoogleStart direct={direct} />
            <AgentPrompt />
          </div>
          <p className="guest">Already asked someone for a time? <a href="#">Resume your request</a></p>
        </div>
        <ExampleCards />
      </main>

      <section className="steps" aria-labelledby="steps-h">
        <h2 id="steps-h">Three steps, then it runs in your messages.</h2>
        <ol>
          <li><h3>Start with Google</h3><p>Sign in and connect your calendar in one step.</p></li>
          <li><h3>Link your phone</h3><p>Thyme texts you from then on.</p></li>
          <li><h3>Share your link</h3><p>Anyone can ask for a time. They need no account.</p></li>
        </ol>
      </section>

      <footer className="foot">
        <p>Thoughtful scheduling. One meeting at a time.</p>
        <div className="legal">
          <nav className="legal-links" aria-label="Legal"><a href="#">Privacy Policy</a><a href="#">Terms of Service</a></nav>
          <p>© 2026 {PRODUCT_NAME}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

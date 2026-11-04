import type { ReactNode } from "react";
import { Brand, InkStage } from "@/app/_components/ink/chrome";
import { GoogleLogo } from "@/app/_components/ink/icons";
import { LiveThread } from "@/app/_components/ink/landing-parts";
import "@/app/_components/ink/landing.css";

export type SignInNotice = "failed" | "limited" | null;

const NOTICES: Readonly<Record<Exclude<SignInNotice, null>, string>> = {
  failed: "Sign-in did not complete. Try again.",
  limited: "New sign-ups are temporarily limited. Try again later; existing hosts can still sign in.",
};

// The landing's spread at sign-in: the way in on paper, and Thyme's example
// conversations on the ink-blue page beside it (DESIGN.md: landing).
function SignInShell({ children }: { readonly children: ReactNode }) {
  return (
    <InkStage locale="en">
      <div className="ld" data-screen="sign-in">
        <div className="ld-spread">
          <div className="ld-paper">
            <header className="ld-top">
              <Brand />
            </header>
            <main className="ld-pitch">{children}</main>
          </div>
          <div className="ld-page">
            <LiveThread locale="en" />
          </div>
        </div>
      </div>
    </InkStage>
  );
}

export function WorkspaceLoading() {
  return (
    <SignInShell>
      <div className="ld-sign" role="status">
        <p className="ld-sign-title">Welcome to Thyme</p>
        <p className="ld-lede">Loading your workspace…</p>
      </div>
    </SignInShell>
  );
}

// Google is the only sign-in method (chat-workspaces: Google-only MVP host login).
// The notice reports why the last sign-in returned without a session.
export function SignInCard({
  heading = "h1",
  notice = null,
}: {
  readonly heading?: "h1" | "h2";
  readonly notice?: SignInNotice;
}) {
  const Heading = heading;

  return (
    <SignInShell>
      <section className="ld-sign">
        <p className="ld-eyebrow">Your workspace</p>
        <Heading className="ld-sign-title">Find Me a Time</Heading>
        <p className="ld-lede">Sign in to set up how people book time with you.</p>
        {notice ? (
          <p className={`ld-notice ${notice === "limited" ? "warning" : "error"}`} role="alert">
            {NOTICES[notice]}
          </p>
        ) : null}
        <a className="gbtn" href="/auth/sign-in">
          <GoogleLogo />
          <span>Continue with Google</span>
        </a>
      </section>
    </SignInShell>
  );
}

import type { ReactNode } from "react";
import "@/app/_components/ink/ink.css";

export type SignInNotice = "failed" | "limited" | null;

const NOTICES: Readonly<Record<Exclude<SignInNotice, null>, string>> = {
  failed: "Sign-in did not complete. Try again.",
  limited: "New sign-ups are temporarily limited. Try again later; existing hosts can still sign in.",
};

function SignInShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className="onboarding-ink min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header>
          <a className="font-display text-[clamp(26px,3vw,33px)] leading-none text-foreground" href="/">Find Me a Time</a>
        </header>
        <div className="grid flex-1 place-items-center py-10">{children}</div>
      </div>
    </main>
  );
}

export function WorkspaceLoading() {
  return (
    <SignInShell>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card px-7 py-9 shadow-[0_16px_44px_rgb(30_36_48/0.08)] sm:px-9" role="status">
        <p className="font-display text-4xl leading-tight">Welcome to Thyme</p>
        <p className="mt-3 text-muted-foreground">Loading your workspace…</p>
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
      <section className="w-full max-w-md rounded-2xl border border-border bg-card px-7 py-9 shadow-[0_16px_44px_rgb(30_36_48/0.08)] sm:px-9">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your workspace</p>
        <Heading className="font-display mt-2 text-4xl leading-tight">Find Me a Time</Heading>
        <p className="mt-3 text-muted-foreground">Sign in to set up how people book time with you.</p>
        {notice ? (
          <p className={`mt-5 rounded-lg bg-secondary px-4 py-3 text-sm ${notice === "limited" ? "text-warning" : "text-destructive"}`} role="alert">
            {NOTICES[notice]}
          </p>
        ) : null}
        <a
          className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground transition-colors hover:bg-[var(--primary-hover)]"
          href="/auth/sign-in"
        >
          Continue with Google
        </a>
      </section>
    </SignInShell>
  );
}

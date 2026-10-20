export type SignInNotice = "failed" | "limited" | null;

const NOTICES: Readonly<Record<Exclude<SignInNotice, null>, string>> = {
  failed: "Sign-in did not complete. Try again.",
  limited: "New sign-ups are temporarily limited. Try again later; existing hosts can still sign in.",
};

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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <Heading className="font-display text-3xl">Find Me a Time</Heading>
        <p className="mt-2 text-muted-foreground">Sign in to set up how people book time with you.</p>
      </div>
      {notice ? (
        <p className={notice === "limited" ? "text-warning" : "text-destructive"} role="alert">
          {NOTICES[notice]}
        </p>
      ) : null}
      <a
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        href="/auth/sign-in"
      >
        Sign in with Google
      </a>
    </main>
  );
}

// Google is the only sign-in method (chat-workspaces: Google-only MVP host login).
export function SignInCard({ failed = false, heading = "h1" }: { readonly failed?: boolean; readonly heading?: "h1" | "h2" }) {
  const Heading = heading;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <Heading className="font-display text-3xl">Find Me a Time</Heading>
        <p className="mt-2 text-muted-foreground">Sign in to set up how people book time with you.</p>
      </div>
      {failed ? (
        <p className="text-destructive" role="alert">
          Sign-in did not complete. Try again.
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

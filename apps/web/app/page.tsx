export default function Page() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <h1 className="text-2xl font-semibold">Find Me a Time</h1>
      <a
        className="inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
        href="/auth/sign-in"
      >
        Sign in with Google
      </a>
    </main>
  );
}

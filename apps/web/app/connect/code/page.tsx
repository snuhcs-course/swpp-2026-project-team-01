import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

// The headless CLI login's return (agent-access D14): the authorization
// response arrives here instead of a loopback callback, and the page shows the
// value to paste into `fmat login --no-browser`, the state and the code joined
// by a dot. The code is useless without the CLI's PKCE verifier.

export const metadata: Metadata = { referrer: "no-referrer", robots: { follow: false, index: false }, title: "Finish signing in to the CLI" };

type SearchParams = Promise<{ code?: string; state?: string; error?: string }>;

const VALUE = /^[A-Za-z0-9_.~-]{1,1000}$/;

export default function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading...</p>}>
      <Code searchParams={searchParams} />
    </Suspense>
  );
}

async function Code({ searchParams }: { readonly searchParams: SearchParams }) {
  await connection();
  const { code, error, state } = await searchParams;
  const valid = code && state && VALUE.test(code) && VALUE.test(state);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
      {valid ? (
        <>
          <h1 className="font-display text-3xl">Paste this into the CLI</h1>
          <p className="text-muted-foreground">Copy the whole value and paste it where `fmat login` is waiting. It works once, for one minute.</p>
          <output className="block break-all rounded-lg border border-border bg-muted p-3 font-mono text-sm select-all">
            {`${state}.${code}`}
          </output>
        </>
      ) : (
        <>
          <h1 className="font-display text-3xl">Nothing to paste</h1>
          <p className="text-muted-foreground">
            {error === "access_denied" ? "You denied the connection. The CLI is not signed in." : "This page has no sign-in code. Run fmat login again."}
          </p>
        </>
      )}
    </main>
  );
}

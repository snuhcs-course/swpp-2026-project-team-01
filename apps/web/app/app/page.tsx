import { openHostWorkspace } from "@lib/server/web-session";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { HostWorkspace } from "@/app/_components/host-workspace";
import { LOCALE_COOKIE, localeOf } from "@/app/_components/ink/copy";
import { LinkStep } from "@/app/_components/ink/link-step";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { SignInCard, WorkspaceLoading } from "@/app/_components/sign-in-card";

// The single host page. Signed out, it offers Google sign-in; a suspended
// account sees why it cannot continue; an active host gets the conversation,
// whose empty setup session this visit opens on the server, after the iMessage
// link step when it applies.
type SearchParams = Promise<{ sign_in?: string }>;

// Authentication must run before any reusable page shell can be served.
export const instant = false;

export default async function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  // The whole host page depends on the browser's session. Keep the request-time
  // boundary outside Suspense so the signed-out shell cannot be CDN cached.
  await connection();
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <Workspace searchParams={searchParams} />
    </Suspense>
  );
}

async function Workspace({ searchParams }: { readonly searchParams: SearchParams }) {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const standing = await openHostWorkspace(cookie);

  if (!standing || standing.nextAction === "sign_in") {
    const { sign_in: signIn } = await searchParams;
    return <SignInCard notice={signIn === "failed" || signIn === "limited" ? signIn : null} />;
  }

  if (!standing.eligible) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
        <div className="flex items-center justify-between">
          <h1 className="wordmark-lockup">Find Me a Time</h1>
          <WorkspaceMenu />
        </div>
        <p>This host account is suspended, so the workspace is unavailable. Contact support to restore it.</p>
      </main>
    );
  }

  return (
    <LinkStep locale={localeOf(jar.get(LOCALE_COOKIE)?.value)} ready={standing.ready}>
      <HostWorkspace />
    </LinkStep>
  );
}

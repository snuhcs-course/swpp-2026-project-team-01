import { hostStandingFromCookies } from "@lib/server/web-session";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { HostWorkspace } from "@/app/_components/host-workspace";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { SignInCard } from "@/app/_components/sign-in-card";

// The single host page. Signed out, it offers Google sign-in; a suspended
// account sees why it cannot continue; an active host gets the conversation.
type SearchParams = Promise<{ sign_in?: string }>;

export default function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading your workspace...</p>}>
      <Workspace searchParams={searchParams} />
    </Suspense>
  );
}

async function Workspace({ searchParams }: { readonly searchParams: SearchParams }) {
  await connection();
  const cookie = (await cookies())
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const standing = await hostStandingFromCookies(cookie);

  if (!standing || standing.nextAction === "sign_in") {
    const { sign_in: signIn } = await searchParams;
    return <SignInCard failed={signIn === "failed"} />;
  }

  if (!standing.eligible) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl">Find Me a Time</h1>
          <WorkspaceMenu />
        </div>
        <p>This host account is suspended, so the workspace is unavailable. Contact support to restore it.</p>
      </main>
    );
  }

  return <HostWorkspace />;
}

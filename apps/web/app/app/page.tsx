import { missingConfiguration } from "@lib/server/commands";
import { database } from "@lib/server/database";
import { hasLinkedPhone, readPhoneLink } from "@lib/server/imessage-links";
import { IMESSAGE_TRANSPORT_REQUIRES } from "@lib/server/imessage-transport";
import { openHostWorkspace } from "@lib/server/web-session";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { HostWorkspace } from "@/app/_components/host-workspace";
import { PhoneGate } from "@/app/_components/phone/phone-gate";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { SignInCard } from "@/app/_components/sign-in-card";

// The single host page. Signed out, it offers Google sign-in; a suspended
// account sees why it cannot continue; an active host still setting up is asked
// for an iMessage number first (host-imessage-linking), then gets the
// conversation, whose empty setup session this visit opens on the server.
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
  const standing = await openHostWorkspace(cookie);

  if (!standing || standing.nextAction === "sign_in") {
    const { sign_in: signIn } = await searchParams;
    return <SignInCard notice={signIn === "failed" || signIn === "limited" ? signIn : null} />;
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

  // The phone check comes first for a host who is still setting up, has no
  // linked number and is on a deployment where the check is configured.
  if (!standing.ready && standing.hostAccountId && missingConfiguration(IMESSAGE_TRANSPORT_REQUIRES).length === 0) {
    const db = database();

    if (!(await hasLinkedPhone(db, standing.hostAccountId))) {
      return (
        <PhoneGate initial={await readPhoneLink(db, standing.hostAccountId)}>
          <HostWorkspace />
        </PhoneGate>
      );
    }
  }

  return <HostWorkspace />;
}

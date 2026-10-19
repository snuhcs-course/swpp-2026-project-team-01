import { isUsableHandle, normalizeHandle } from "@lib/contracts/handles";
import { database } from "@lib/server/database";
import { findReadyHostByHandle } from "@lib/server/readiness";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgentSection } from "@/app/_components/agent-section";

// A ready host's public page (public-agent-entry). Everything else, including a
// released, unready or suspended host, gets the neutral not-found page. Reserved
// names never reach here: their routes are resolved first or fail the format.
type Params = Promise<{ handle: string }>;

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  const handle = normalizeHandle((await params).handle);

  return {
    robots: { follow: false, index: false },
    ...(isUsableHandle(handle) ? { alternates: { types: { "text/markdown": `/${handle}/SKILL.md` } } } : {}),
  };
}

export default function Page({ params }: { readonly params: Params }) {
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading...</p>}>
      <HostProfile params={params} />
    </Suspense>
  );
}

async function HostProfile({ params }: { readonly params: Params }) {
  await connection();
  const handle = normalizeHandle((await params).handle);

  if (!isUsableHandle(handle)) notFound();

  const host = await findReadyHostByHandle(database(), handle);

  if (!host) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-4 py-16">
      <section className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-sm">Find Me a Time host</p>
        <h1 className="break-words font-display text-[clamp(28px,4vw,40px)] leading-tight">{host.displayName}</h1>
        <p className="font-mono text-muted-foreground">@{host.handle}</p>
      </section>
      <p>
        Requests at this page open in a later release, so nothing can be requested here yet. You will not need an account
        to request a meeting.
      </p>
      <AgentSection href={`/${host.handle}/SKILL.md`}>
        Requests are not accepted yet, so an agent cannot request or book a meeting with this host today.
      </AgentSection>
    </main>
  );
}

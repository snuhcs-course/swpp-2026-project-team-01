import { isUsableHandle, normalizeHandle } from "@lib/contracts/handles";
import { database } from "@lib/server/database";
import { findReadyHostByHandle } from "@lib/server/readiness";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgentSection } from "@/app/_components/agent-section";
import { IntakeWorkspace } from "@/app/_components/guest/intake-workspace";

// A ready host's public page (public-agent-entry) with the anonymous intake
// conversation (design decision 2). Everything else, including a released,
// unready or suspended host, gets the neutral not-found page. Reserved names
// never reach here: their routes are resolved first or fail the format.
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
    <IntakeWorkspace
      agentSection={
        <AgentSection href={`/${host.handle}/SKILL.md`}>
          Requests are accepted on this page in a web browser. Connecting a personal agent is not available yet, so an
          agent should send the person here.
        </AgentSection>
      }
      displayName={host.displayName}
      handle={host.handle}
    />
  );
}

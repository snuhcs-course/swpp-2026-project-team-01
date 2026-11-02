import { isUsableHandle, normalizeHandle } from "@lib/contracts/handles";
import { database } from "@lib/server/database";
import { findReadyHostByHandle } from "@lib/server/readiness";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GuestStart } from "@/app/_components/guest/guest-start";

// A ready host's booking link (public-agent-entry; guest-flow-completion U6 to
// U8): the landing with **Continue with web** and **Start with agent**, and the
// web start's fixed messages and identity card. Everything else, including a
// released, unready or suspended host, gets the neutral not-found page.
// Reserved names never reach here: their routes are resolved first or fail the
// format. The landing offers no email start (guest-flow-completion U20): an
// email that names the host's @handle still starts a request
// (requester-email-channel D6), but the page does not advertise it.
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

  return <GuestStart host={{ displayName: host.displayName, handle: host.handle }} />;
}

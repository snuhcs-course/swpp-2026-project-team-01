import { isUsableHandle, normalizeHandle } from "@lib/contracts/handles";
import { agentMailConfigFromEnvironment } from "@lib/server/agentmail";
import { database } from "@lib/server/database";
import { findReadyHostByHandle } from "@lib/server/readiness";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgentSection } from "@/app/_components/agent-section";
import { GuestWorkspace, PublicPageChrome } from "@/app/_components/guest/guest-workspace";

// A ready host's public page (public-agent-entry) with the guest thread (design
// decision 2): the guest's first message starts a draft request, and the same
// thread continues at the booking link once they give a name and email. Everything else, including a released,
// unready or suspended host, gets the neutral not-found page. Reserved names
// never reach here: their routes are resolved first or fail the format. When the
// product inbox is configured, the page also offers starting by email, with the
// host's @handle in the subject (requester-email-channel D2).
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

  const inbox = agentMailConfigFromEnvironment().inboxId;

  return (
    <GuestWorkspace
      chrome={
        <PublicPageChrome
          agentSection={
            <>
              <AgentSection href={`/${host.handle}/SKILL.md`}>
                Requests are accepted on this page in a web browser, or by a personal agent through the MCP server at{" "}
                {`/${host.handle}/mcp`} once the person allows it. The instructions explain how.
              </AgentSection>
              {inbox ? (
                <p className="pt-2 text-sm text-muted-foreground" data-email-start="">
                  Prefer email?{" "}
                  <a
                    className="underline underline-offset-4"
                    href={`mailto:${inbox}?subject=${encodeURIComponent(`Meeting with @${host.handle}`)}`}
                  >
                    Write to {inbox}
                  </a>
                  ; the link fills in the subject that names this host.
                </p>
              ) : null}
            </>
          }
        />
      }
      host={{ displayName: host.displayName, handle: host.handle }}
    />
  );
}

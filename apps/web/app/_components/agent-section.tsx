import type { ReactNode } from "react";

// The visible agent section of a public page (public-agent-entry: discoverable
// from plain URLs). An agent that converts the HTML to text finds the matching
// instruction document here; the copy says that reading it grants nothing.
export function AgentSection({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <section aria-labelledby="agent-section-heading" className="rounded-xl border border-border bg-card p-6">
      <h2 className="font-semibold text-lg" id="agent-section-heading">
        For AI agents
      </h2>
      <p className="mt-2 text-muted-foreground">
        Plain-text instructions for agents are at{" "}
        <a className="break-all font-mono text-primary underline underline-offset-4" href={href}>
          {href}
        </a>
        . Reading them installs no tools and grants no access.
      </p>
      <p className="mt-2 text-muted-foreground">{children}</p>
    </section>
  );
}

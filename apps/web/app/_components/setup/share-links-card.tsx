"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SetupCard } from "./card";
import { useSetup } from "./setup-context";

// The share-links card (H10). The links come only from the server's derived
// readiness, so the card renders nothing while `links` is null.

export const LINKS_CARD_ID = "setup-links";

export function ShareLinksCard() {
  const { state } = useSetup();
  const links = state.links;

  if (!links) return null;

  return (
    <SetupCard
      className="border-primary/40"
      eyebrow="Ready"
      id={LINKS_CARD_ID}
      title="You're ready."
      description="Share your booking link with people, or the skill document with their AI agents."
    >
      <ShareLink href={links.booking} label="Booking link" />
      <ShareLink href={links.skill} label="Skill document for agents" />
    </SetupCard>
  );
}

function ShareLink({ href, label }: { readonly href: string; readonly label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">{label}</p>
      <p className="font-mono text-sm break-all">{href}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy()} type="button" variant="outline">
          {status === "copied" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          Copy
        </Button>
        <Button asChild variant="ghost">
          <a aria-label={`Open ${label.toLowerCase()} in a new tab`} href={href} rel="noopener noreferrer" target="_blank">
            <ExternalLinkIcon aria-hidden />
            Open
          </a>
        </Button>
        <span aria-live="polite" className="text-sm text-muted-foreground" role="status">
          {status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy; select the link above instead." : ""}
        </span>
      </div>
    </div>
  );
}

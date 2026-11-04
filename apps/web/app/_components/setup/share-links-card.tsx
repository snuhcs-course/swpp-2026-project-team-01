"use client";

import { CheckIcon, CircleCheckIcon, CopyIcon, ShareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cardHeadingId } from "./card";
import { useSetup } from "./setup-context";

// The share-links card (H10), kept to one quiet row: the booking link with Copy,
// and Share where the device has a share sheet (a phone or tablet). The skill
// document stays reachable from the booking page's "For AI agents" section. The
// links come only from the server's derived readiness, so the row renders
// nothing while `links` is null.

export const LINKS_CARD_ID = "setup-links";

export function ShareLinksCard() {
  const { state } = useSetup();
  const links = state.links;
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (!links) return null;
  const href = links.booking;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <section
      aria-labelledby={cardHeadingId(LINKS_CARD_ID)}
      className="setup-card-enter flex min-w-0 scroll-mt-4 scroll-mb-4 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-card px-4 py-2.5 text-sm text-card-foreground"
      data-setup-card={LINKS_CARD_ID}
      id={LINKS_CARD_ID}
    >
      <h3 className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-foreground outline-none" id={cardHeadingId(LINKS_CARD_ID)} tabIndex={-1}>
        <CircleCheckIcon aria-hidden className="size-4 text-primary" />
        You&apos;re ready.
      </h3>
      <div className="flex min-w-[min(100%,16rem)] flex-1 items-center gap-1">
        <p className="min-w-0 flex-1 truncate font-mono text-sm text-foreground" title={href}>
          {href.replace(/^https?:\/\//, "")}
        </p>
        <Button aria-label="Copy booking link" onClick={() => void copy()} size="sm" type="button" variant="outline">
          {status === "copied" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          Copy
        </Button>
        {canShare ? (
          <Button aria-label="Share booking link" onClick={() => void navigator.share({ url: href }).catch(() => {})} size="sm" type="button" variant="ghost">
            <ShareIcon aria-hidden />
            Share
          </Button>
        ) : null}
        <span aria-live="polite" className="text-xs text-muted-foreground empty:hidden" role="status">
          {status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy; select the link instead." : ""}
        </span>
      </div>
    </section>
  );
}

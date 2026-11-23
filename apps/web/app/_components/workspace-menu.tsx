"use client";

import { InboxIcon, LayoutDashboardIcon, LogOutIcon, MenuIcon, PlugIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectedAgentsDialog, HOST_GRANT_SOURCE } from "@/app/_components/connected-agents";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readHostRequests } from "@/lib/chat/host-requests";
import { badgeText, pendingDecisionCount, pendingDecisionLabel, REQUESTS_CHANGED_EVENT } from "@/lib/chat/pending-decisions";

// Compact workspace navigation. Messaging connections and personal agents are
// managed together in Connected apps. Connected apps opens its dialog only once
// the menu has closed and returned focus: opened from onSelect, the dialog took
// the closing menu's `pointer-events: none` on <body> for the page's own and left
// it behind, freezing the page (#207). Closing the dialog returns focus to the
// menu button.
//
// Where the menu offers Requests, a red count on the menu button and on that
// item says how many received requests need the host's decision (#295). It
// reloads when the page regains focus, when the menu opens and when a request
// changes in this tab, and disappears once nothing is left to decide.
export function WorkspaceMenu({
  onSelectDashboard,
  onSelectRequests,
}: {
  readonly onSelectDashboard?: () => void;
  readonly onSelectRequests?: () => void;
}) {
  const signOutRef = useRef<HTMLFormElement>(null);
  const agentsSelected = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const pending = usePendingDecisions(onSelectRequests !== undefined);

  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (open) pending.reload(); }}>
        <DropdownMenuTrigger asChild>
          <Button aria-label={pending.count > 0 ? `Open menu, ${pendingDecisionLabel(pending.count)}` : "Open menu"} className="relative" ref={triggerRef} size="icon" type="button" variant="ghost">
            <MenuIcon aria-hidden className="size-5" />
            <PendingBadge className="absolute -top-0.5 -right-0.5" count={pending.count} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-48"
          onCloseAutoFocus={() => {
            if (!agentsSelected.current) return;
            agentsSelected.current = false;
            setAgentsOpen(true);
          }}
        >
          {onSelectDashboard ? (
            <DropdownMenuItem onSelect={onSelectDashboard}>
              <LayoutDashboardIcon aria-hidden />
              Dashboard
            </DropdownMenuItem>
          ) : null}
          {onSelectRequests ? (
            <DropdownMenuItem onSelect={onSelectRequests}>
              <InboxIcon aria-hidden />
              Requests
              {pending.count > 0 ? <span className="sr-only">, {pendingDecisionLabel(pending.count)}</span> : null}
              <PendingBadge className="ml-auto" count={pending.count} />
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              agentsSelected.current = true;
            }}
          >
            <PlugIcon aria-hidden />
            Connected apps
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOutRef.current?.requestSubmit()}>
            <LogOutIcon aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form action="/auth/sign-out" hidden method="post" ref={signOutRef} />
      <ConnectedAgentsDialog
        appsMode
        onOpenChange={setAgentsOpen}
        open={agentsOpen}
        returnFocus={triggerRef}
        source={HOST_GRANT_SOURCE}
      />
    </>
  );
}

/** The round red count; nothing when no request needs a decision. */
export function PendingBadge({ className = "", count }: { readonly className?: string; readonly count: number }) {
  if (count <= 0) return null;
  return (
    <span aria-hidden className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#c62828] px-1 text-[11px] leading-none font-semibold text-white ${className}`} data-slot="pending-badge">
      {badgeText(count)}
    </span>
  );
}

// The host's received requests that need a decision. A failed read keeps the
// last count; the next focus, menu opening or request change reads again.
function usePendingDecisions(enabled: boolean) {
  const [count, setCount] = useState(0);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
    if (!enabled) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    readHostRequests(current.signal)
      .then((items) => {
        if (!current.signal.aborted) setCount(pendingDecisionCount(items));
      })
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", reload);
    window.addEventListener(REQUESTS_CHANGED_EVENT, reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.current?.abort();
      window.removeEventListener("focus", reload);
      window.removeEventListener(REQUESTS_CHANGED_EVENT, reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, reload]);

  return { count, reload };
}

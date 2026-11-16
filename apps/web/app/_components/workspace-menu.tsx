"use client";

import { InboxIcon, LayoutDashboardIcon, LogOutIcon, MenuIcon, PlugIcon } from "lucide-react";
import { useRef, useState } from "react";
import { ConnectedAgentsDialog, HOST_GRANT_SOURCE } from "@/app/_components/connected-agents";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Compact workspace navigation. Messaging connections and personal agents are
// managed together in Connected apps. Connected apps opens its dialog only once
// the menu has closed and returned focus: opened from onSelect, the dialog took
// the closing menu's `pointer-events: none` on <body> for the page's own and left
// it behind, freezing the page (#207). Closing the dialog returns focus to the
// menu button.
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Open menu" ref={triggerRef} size="icon" type="button" variant="ghost">
            <MenuIcon aria-hidden className="size-5" />
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

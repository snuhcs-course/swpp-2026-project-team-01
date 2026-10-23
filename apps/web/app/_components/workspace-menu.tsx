"use client";

import { InboxIcon, ListChecksIcon, LogOutIcon, MenuIcon, MessageCircleIcon, PlugIcon } from "lucide-react";
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

// The workspace's compact, keyboard-operable navigation: Setup, Requests (the
// inbox of meeting requests), iMessage (the Connect iMessage card), Connected
// agents (agent-access design 10, also for a suspended host, who keeps
// revocation) and Sign out. Radix gives the menu arrow-key movement, closes it on
// Escape and returns focus to the trigger, except after Setup and iMessage, which
// move focus to the current setup card or the iMessage card instead.
export function WorkspaceMenu({
  onSelectImessage,
  onSelectRequests,
  onSelectSetup,
}: {
  readonly onSelectImessage?: () => void;
  readonly onSelectRequests?: () => void;
  readonly onSelectSetup?: () => void;
}) {
  const signOutRef = useRef<HTMLFormElement>(null);
  const setupSelected = useRef(false);
  const imessageSelected = useRef(false);
  const [agentsOpen, setAgentsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Open menu" size="icon" type="button" variant="ghost">
            <MenuIcon aria-hidden className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-48"
          onCloseAutoFocus={(event) => {
            if (imessageSelected.current) {
              imessageSelected.current = false;
              event.preventDefault();
              onSelectImessage?.();
              return;
            }
            if (!setupSelected.current) return;
            setupSelected.current = false;
            event.preventDefault();
            onSelectSetup?.();
          }}
        >
          {onSelectSetup ? (
            <DropdownMenuItem
              onSelect={() => {
                setupSelected.current = true;
              }}
            >
              <ListChecksIcon aria-hidden />
              Setup
            </DropdownMenuItem>
          ) : null}
          {onSelectRequests ? (
            <DropdownMenuItem onSelect={onSelectRequests}>
              <InboxIcon aria-hidden />
              Requests
            </DropdownMenuItem>
          ) : null}
          {onSelectImessage ? (
            <DropdownMenuItem
              onSelect={() => {
                imessageSelected.current = true;
              }}
            >
              <MessageCircleIcon aria-hidden />
              iMessage
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setAgentsOpen(true)}>
            <PlugIcon aria-hidden />
            Connected agents
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOutRef.current?.requestSubmit()}>
            <LogOutIcon aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form action="/auth/sign-out" hidden method="post" ref={signOutRef} />
      <ConnectedAgentsDialog onOpenChange={setAgentsOpen} open={agentsOpen} source={HOST_GRANT_SOURCE} />
    </>
  );
}

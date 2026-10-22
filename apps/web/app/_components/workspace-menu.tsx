"use client";

import { InboxIcon, ListChecksIcon, LogOutIcon, MenuIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The workspace's compact, keyboard-operable navigation: Setup, Requests (the
// inbox of meeting requests) and Sign out. Radix gives the menu arrow-key
// movement, closes it on Escape and returns focus to the trigger, except after
// Setup, which moves focus to the current setup card instead.
export function WorkspaceMenu({
  onSelectRequests,
  onSelectSetup,
}: {
  readonly onSelectRequests?: () => void;
  readonly onSelectSetup?: () => void;
}) {
  const signOutRef = useRef<HTMLFormElement>(null);
  const setupSelected = useRef(false);

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
          {onSelectSetup || onSelectRequests ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => signOutRef.current?.requestSubmit()}>
            <LogOutIcon aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form action="/auth/sign-out" hidden method="post" ref={signOutRef} />
    </>
  );
}

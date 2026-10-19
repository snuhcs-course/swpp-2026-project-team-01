"use client";

import { LogOutIcon, MenuIcon, MessageSquareIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The workspace's compact, keyboard-operable navigation. Radix gives the menu
// arrow-key movement, closes it on Escape and returns focus to the trigger.
export function WorkspaceMenu({ onSelectSetup }: { readonly onSelectSetup?: () => void }) {
  const signOutRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Open menu" size="icon" type="button" variant="ghost">
            <MenuIcon aria-hidden className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {onSelectSetup ? (
            <DropdownMenuItem onSelect={onSelectSetup}>
              <MessageSquareIcon aria-hidden />
              Setup conversation
            </DropdownMenuItem>
          ) : null}
          {onSelectSetup ? <DropdownMenuSeparator /> : null}
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

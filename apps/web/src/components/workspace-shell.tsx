import { useState, type ReactNode } from "react"
import { CalendarDays, Inbox, LogOut, Menu, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ServiceNotices } from "@/components/service-notices"
import { Notice } from "@/lib/ui"

export function WorkspaceShell({
  email,
  onSignOut,
  children,
}: {
  email: string
  onSignOut: () => void | Promise<void>
  children: ReactNode
}) {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState("")

  return (
    <div className="min-h-svh bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a
          href="/host/setup"
          className="flex min-w-0 items-center gap-2 font-semibold"
        >
          <CalendarDays aria-hidden="true" className="text-primary" />
          <span className="truncate">Find Me a Time</span>
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon" />}
            aria-label="Open workspace menu"
          >
            <Menu aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="max-w-56 truncate" title={email}>
                {email}
              </DropdownMenuLabel>
              <DropdownMenuItem render={<a href="/host/setup" />}>
                <Settings2 aria-hidden="true" />
                Setup conversation
              </DropdownMenuItem>
              <DropdownMenuItem render={<a href="/host/inbox" />}>
                <Inbox aria-hidden="true" />
                Meeting inbox
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true)
                  setError("")
                  try {
                    await onSignOut()
                  } catch {
                    setError("Could not sign out. Please try again.")
                  } finally {
                    setSigningOut(false)
                  }
                }}
              >
                <LogOut aria-hidden="true" />
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pb-6 sm:px-6"
      >
        <ServiceNotices />
        {error && <Notice error>{error}</Notice>}
        {children}
      </main>
    </div>
  )
}

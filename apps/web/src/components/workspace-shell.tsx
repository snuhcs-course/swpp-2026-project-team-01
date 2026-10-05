import { useState, type ReactNode } from "react"
import {
  CalendarDays,
  Inbox,
  LogOut,
  Settings2,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ServiceNotices } from "@/components/service-notices"
import { Notice } from "@/lib/ui"

// Adapted from shadcn's sidebar-08 inset workspace block.
export function WorkspaceShell({
  email,
  onSignOut,
  children,
}: {
  email: string
  onSignOut: () => void | Promise<void>
  children: ReactNode
}) {
  const review = location.pathname.startsWith("/host/requests/")
  const inbox = review || location.pathname === "/host/inbox"
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState("")
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar variant="inset">
          <SidebarHeader className="p-4">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" render={<a href="/" />}>
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <CalendarDays />
                  </div>
                  <div className="grid gap-0.5 text-left">
                    <span className="font-semibold">Find Me a Time</span>
                    <span className="text-xs text-muted-foreground">
                      Host workspace
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup className="px-4">
              <SidebarGroupLabel>Your workspace</SidebarGroupLabel>
              <nav aria-label="Workspace navigation">
                <SidebarMenu className="gap-1">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={inbox}
                      aria-current={
                        location.pathname === "/host/inbox" ? "page" : undefined
                      }
                      render={<a href="/host/inbox" />}
                    >
                      <Inbox />
                      <span>Meeting inbox</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={!inbox}
                      aria-current={!inbox ? "page" : undefined}
                      render={<a href="/host/setup" />}
                    >
                      <Settings2 />
                      <span>Scheduling setup</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </nav>
            </SidebarGroup>
            <div className="mt-auto flex flex-col gap-3 px-6 py-8 text-sm text-muted-foreground">
              <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
              <p className="font-medium text-foreground">
                Your calendar. Your call.
              </p>
              <p className="text-xs leading-relaxed">
                Every meeting needs your approval before it can be booked.
              </p>
            </div>
          </SidebarContent>
          <SidebarFooter className="gap-3 p-4">
            <Separator />
            <div className="flex min-w-0 items-center gap-3 px-2 pt-2">
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                aria-hidden="true"
              >
                {email.slice(0, 1).toUpperCase() || "H"}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Signed in as</p>
                <p className="truncate text-sm" title={email}>
                  {email}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              className="justify-start"
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
              <LogOut data-icon="inline-start" />
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset id="main" tabIndex={-1} className="min-w-0">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="data-vertical:h-4 data-vertical:self-auto"
            />
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden text-muted-foreground sm:inline">
                Workspace
              </span>
              <span
                className="hidden text-muted-foreground sm:inline"
                aria-hidden="true"
              >
                /
              </span>
              <span className="truncate font-medium">
                {review
                  ? "Meeting review"
                  : inbox
                    ? "Meeting inbox"
                    : "Scheduling setup"}
              </span>
            </div>
          </header>
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 py-6 sm:p-6 lg:p-8">
            <ServiceNotices />
            {error && <Notice error>{error}</Notice>}
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

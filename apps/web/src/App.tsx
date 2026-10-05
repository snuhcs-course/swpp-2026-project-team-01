import { CalendarDays, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { lazy, Suspense } from "react"
import { Landing } from "./Landing"
import { Requester } from "./Requester"
import { ServiceNotices } from "@/components/service-notices"
import { Loading, Notice } from "@/lib/ui"

const Host = lazy(() =>
  import("./Host").then((module) => ({ default: module.Host }))
)
const Inbox = lazy(() =>
  import("./Requests").then((module) => ({ default: module.Inbox }))
)
const RequestPage = lazy(() =>
  import("./Requests").then((module) => ({ default: module.RequestPage }))
)

export default function App() {
  const path = location.pathname.split("/").filter(Boolean)
  let content
  if (!path.length) content = <Landing />
  else if (path[0] === "host")
    content = (
      <Host>
        {path[1] === "inbox" ? (
          <Inbox />
        ) : path[1] === "requests" && path[2] ? (
          <RequestPage id={path[2]} host />
        ) : undefined}
      </Host>
    )
  else if (path[0] === "requests" && path[1])
    content = <RequestPage id={path[1]} />
  else if (path.length === 1) content = <Requester handle={path[0]} />
  else
    content = (
      <Notice error>
        This page could not be found.{" "}
        <a href="/" className="underline">
          Return home
        </a>
        .
      </Notice>
    )
  if (path[0] === "host")
    return (
      <>
        <a href="#main" className="sr-only focus:not-sr-only">
          Skip to content
        </a>
        <Suspense
          fallback={
            <main
              id="main"
              tabIndex={-1}
              className="mx-auto w-full max-w-6xl px-5 py-10"
            >
              <Loading />
            </main>
          }
        >
          {content}
        </Suspense>
      </>
    )
  if (path.length)
    return (
      <div className="min-h-svh bg-background">
        <a href="#main" className="sr-only focus:not-sr-only">
          Skip to content
        </a>
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex min-w-0 items-center gap-2 font-semibold">
            <CalendarDays aria-hidden="true" className="text-primary" />
            <span className="truncate">Find Me a Time</span>
          </a>
          <Button
            render={<a href="/host" />}
            nativeButton={false}
            variant="ghost"
            size="icon"
            aria-label="Host workspace"
          >
            <Settings2 aria-hidden="true" />
          </Button>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pb-6 sm:px-6"
        >
          <ServiceNotices />
          <Suspense fallback={<Loading />}>{content}</Suspense>
        </main>
      </div>
    )
  return (
    <div className="min-h-svh">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <header className="border-b bg-background">
        <nav
          className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4"
          aria-label="Main navigation"
        >
          <a href="/" className="flex items-center gap-2 font-semibold">
            <CalendarDays className="size-5 text-primary" />
            Find Me a Time
          </a>
          <Button
            render={<a href="/host" />}
            nativeButton={false}
            variant="ghost"
          >
            Host workspace
          </Button>
        </nav>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10"
      >
        <ServiceNotices />
        <Suspense fallback={<Loading />}>{content}</Suspense>
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-5 py-8 text-sm text-muted-foreground">
        <p>Made for the meetings worth making time for.</p>
        <a href="/host" className="underline">
          Host workspace
        </a>
      </footer>
    </div>
  )
}

import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Host } from './Host'
import { Landing } from './Landing'
import { Requester } from './Requester'
import { Inbox, RequestPage } from './Requests'
import { configured } from '@/lib/api'
import { Notice } from '@/lib/ui'

export default function App() {
  const path = location.pathname.split('/').filter(Boolean)
  let content
  if (!path.length) content = <Landing />
  else if (path[0] === 'host') content = <Host>{path[1] === 'inbox' ? <Inbox /> : path[1] === 'requests' && path[2] ? <RequestPage id={path[2]} host /> : undefined}</Host>
  else if (path[0] === 'requests' && path[1]) content = <RequestPage id={path[1]} />
  else if (path.length === 1) content = <Requester handle={path[0]} />
  else content = <Notice error>This page could not be found. <a href="/" className="underline">Return home</a>.</Notice>
  return <div className="min-h-svh"><a href="#main" className="sr-only focus:not-sr-only">Skip to content</a><header className="border-b"><nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4" aria-label="Main navigation"><a href="/" className="flex items-center gap-2 font-semibold"><CalendarDays className="size-5 text-primary" />Find Me a Time</a><Button render={<a href="/host" />} nativeButton={false} variant="ghost">Host workspace</Button></nav></header><main id="main" className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10">{!configured && <Notice>The scheduling service is being configured. Please try again later.</Notice>}{content}</main><footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-5 py-8 text-sm text-muted-foreground"><p>Made for the meetings worth making time for.</p><a href="/host" className="underline">Host workspace</a></footer></div>
}

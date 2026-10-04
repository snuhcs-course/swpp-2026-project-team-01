import { readServerConfig } from "@/server/config"
import Link from "next/link"
import { currentUser, db, now } from "@/server/context"
import { listUsers } from "@/server/repos/users"
import { pendingCount } from "@/server/services/booking"
import { NavMenu, type NavGroup } from "./NavMenu"
import { UserSwitcher } from "./UserSwitcher"

const NAV: NavGroup[] = [
  {
    label: "예약",
    items: [
      { href: "/book", label: "예약하기" },
      { href: "/requests/sent", label: "내 요청" },
      { href: "/requests/inbox", label: "받은 요청함", badge: "pending" },
    ],
  },
  { label: "일정", items: [{ href: "/calendar", label: "내 캘린더" }] },
  {
    label: "설정",
    items: [
      { href: "/settings/availability", label: "내 시간 프로필" },
      { href: "/settings/calendars", label: "Calendar 연결" },
      { href: "/settings/host", label: "호스트 설정" },
    ],
  },
]

export async function Header() {
  const user = await currentUser()
  const pending = await pendingCount(db(), user.id, now())
  const account =
    readServerConfig().mode === "demo" ? (
      <UserSwitcher users={await listUsers(db())} currentId={user.id} />
    ) : (
      <span className="flex items-center gap-2 text-small text-ink-soft">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary-soft-ink">
          {user.name.slice(0, 1)}
        </span>
        {user.name}
      </span>
    )
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <NavMenu
        groups={NAV}
        pending={pending}
        brand={
          <Link href="/book" className="flex items-center gap-2 rounded-control font-bold tracking-tight text-ink">
            <span aria-hidden="true" className="grid size-7 grid-cols-2 gap-0.5 rounded-md bg-primary p-1.5">
              <span className="rounded-[1px] bg-primary-ink/90" />
              <span className="rounded-[1px] bg-primary-ink/40" />
              <span className="rounded-[1px] bg-primary-ink/40" />
              <span className="rounded-[1px] bg-primary-ink/90" />
            </span>
            AI 미팅 예약
          </Link>
        }
        account={account}
      />
    </header>
  )
}

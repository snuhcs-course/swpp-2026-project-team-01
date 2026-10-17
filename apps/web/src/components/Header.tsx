// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import { readServerConfig } from "@/server/config"
import Link from "next/link"
import { currentUser, db, now } from "@/server/context"
import { listUsers } from "@/server/repos/users"
import { pendingCount } from "@/server/services/booking"
import { LogoutButton } from "./LogoutButton"
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
        <LogoutButton />
      </span>
    )
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <NavMenu
        groups={NAV}
        pending={pending}
        brand={
          <Link href="/app" className="flex items-center gap-2.5 rounded-control text-logo">
            {/* DESIGN.md sizes: mark 10px on phones, 17px to 960px, 20px wider; the wordmark never wraps */}
            <span aria-hidden="true" className="size-2.5 shrink-0 bg-logo [mask:url(/logo-mask.png)_center/contain_no-repeat] sm:size-[17px] lg:size-5" />
            <span className="font-display text-[1.375rem] leading-none font-extrabold whitespace-nowrap [font-variation-settings:'opsz'_72] sm:text-[1.625rem]">Find Me a Time</span>
          </Link>
        }
        account={account}
      />
    </header>
  )
}

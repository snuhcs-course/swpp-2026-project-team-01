import Link from "next/link"
import { currentUser, db, now } from "@/server/context"
import { listUsers } from "@/server/repos/users"
import { pendingCount } from "@/server/services/booking"
import { UserSwitcher } from "./UserSwitcher"

const NAV = [
  { href: "/book", label: "예약하기" },
  { href: "/calendar", label: "내 캘린더" },
  { href: "/settings/availability", label: "가능 시간" },
  { href: "/settings/host", label: "호스트 설정" },
  { href: "/requests/sent", label: "내 요청" },
]

export async function Header() {
  const user = await currentUser()
  const pending = await pendingCount(db(), user.id, now())
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/book" className="font-semibold text-slate-900">
            AI 미팅 예약
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-slate-900">
                {n.label}
              </Link>
            ))}
            <Link href="/requests/inbox" className="hover:text-slate-900">
              받은 요청함
              {pending > 0 && <span className="ml-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-xs text-white">{pending}</span>}
            </Link>
          </nav>
        </div>
        <UserSwitcher users={await listUsers(db())} currentId={user.id} />
      </div>
    </header>
  )
}

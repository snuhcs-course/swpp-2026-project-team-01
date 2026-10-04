"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, type ReactNode } from "react"
import { cn, MenuIcon, XIcon } from "./ui"

export type NavItem = { href: string; label: string; badge?: "pending" }
export type NavGroup = { label: string; items: NavItem[] }

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)

function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-caption font-semibold text-white tabular">
      {count}
      <span className="sr-only">건 대기 중</span>
    </span>
  )
}

export function NavMenu({ groups, pending, brand, account }: { groups: NavGroup[]; pending: number; brand: ReactNode; account: ReactNode }) {
  const pathname = usePathname() ?? ""
  // The menu is open only for the path it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex min-h-14 items-center justify-between gap-3">
        {brand}
        <div className="flex items-center gap-2">
          {account}
          <button
            type="button"
            className="relative inline-flex size-10 items-center justify-center rounded-control text-ink-soft hover:bg-surface-sunken md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
            onClick={() => setOpenOn(open ? null : pathname)}
          >
            {open ? <XIcon size={20} /> : <MenuIcon size={20} />}
            {pending > 0 && !open && <span aria-hidden="true" className="absolute top-2 right-2 size-2 rounded-full bg-danger" />}
          </button>
        </div>
      </div>

      {/* md and up: grouped tab row */}
      <nav aria-label="주요 메뉴" className="-mb-px hidden md:block">
        <ul className="flex items-stretch gap-1 overflow-x-auto">
          {groups.map((group, gi) => (
            <li key={group.label} className="flex items-stretch">
              {gi > 0 && <span aria-hidden="true" className="mx-2 my-3 w-px bg-border" />}
              <span className="sr-only">{group.label}</span>
              <ul className="flex items-stretch gap-1">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href)
                  return (
                    <li key={item.href} className="flex">
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center border-b-2 px-2.5 py-3 text-small font-medium whitespace-nowrap transition-colors",
                          active ? "border-primary text-ink" : "border-transparent text-muted hover:border-border-strong hover:text-ink",
                        )}
                      >
                        {item.label}
                        {item.badge === "pending" && <PendingBadge count={pending} />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      {/* small screens: collapsible grouped list */}
      <nav id="mobile-nav" aria-label="주요 메뉴" hidden={!open} className="border-t border-border py-3 md:hidden">
        <div className="grid gap-4">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-caption font-semibold text-muted">{group.label}</p>
              <ul>
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpenOn(null)}
                        className={cn(
                          "flex min-h-11 items-center rounded-control px-3 text-body font-medium",
                          active ? "bg-primary-soft text-primary-soft-ink" : "text-ink-soft hover:bg-surface-sunken",
                        )}
                      >
                        {item.label}
                        {item.badge === "pending" && <PendingBadge count={pending} />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}

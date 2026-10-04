import Link from "next/link"
import type { ReactNode } from "react"
import { StatusBadge } from "./StatusBadge"
import { AlertIcon, cardClass, ClockIcon, cn } from "./ui"

/** Shared body for a booking request: who, when, status and the message. */
/** `conflictHref` is set only when my own calendar now overlaps this confirmed meeting; it points at the week to look at. */
export function RequestSummary({ name, label, status, message, conflictHref }: { name: string; label: string; status: string; message: string; conflictHref?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold text-ink">{name}</span>
        <StatusBadge status={status} />
      </div>
      <p className="flex items-center gap-1.5 text-small font-medium text-ink-soft tabular">
        <ClockIcon size={14} className="shrink-0 text-muted" />
        {label}
      </p>
      {conflictHref && (
        <p role="note" className="flex items-start gap-1.5 rounded-control bg-warn-soft px-3 py-2 text-small font-medium text-warn-ink">
          <AlertIcon size={14} className="mt-0.5 shrink-0" />
          <span>
            확정한 뒤 내 Calendar에 겹치는 일정이 생겼어요. 미팅은 자동으로 취소되지 않아요.{" "}
            <Link href={conflictHref} className="underline underline-offset-2">내 캘린더에서 확인</Link>
          </span>
        </p>
      )}
      {message && <p className="border-l-2 border-border-strong pl-3 text-small whitespace-pre-wrap text-muted">{message}</p>}
    </div>
  )
}

export function RequestCard({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn(cardClass, "p-4", className)}>{children}</li>
}

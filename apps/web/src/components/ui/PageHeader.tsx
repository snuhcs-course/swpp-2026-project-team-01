import type { ReactNode } from "react"
import { cn } from "./cn"

/** Page title block: optional eyebrow, the h1, a one-line description and actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 max-w-2xl space-y-1.5">
        {eyebrow && <p className="text-caption font-semibold tracking-wide text-primary">{eyebrow}</p>}
        <h1 className="text-h1 font-bold text-ink">{title}</h1>
        {description && <p className="text-body text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

import type { ReactNode } from "react"
import { cn } from "./cn"

export function EmptyState({
  icon,
  title,
  description,
  actions,
  compact = false,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn("rounded-card border border-dashed border-border-strong bg-surface/60 text-center", compact ? "px-4 py-5" : "px-6 py-10", className)}>
      {icon && <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</div>}
      <p className={cn("font-semibold text-ink", compact ? "text-body" : "text-h3")}>{title}</p>
      {description && <div className="mx-auto mt-1.5 max-w-md text-small text-muted">{description}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

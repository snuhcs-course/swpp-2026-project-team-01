import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "./cn"

export const cardClass = "rounded-card border border-border bg-surface shadow-card"

/** The one card surface used across the app. */
export function Card({ as: Tag = "section", className, ...props }: HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "li" }) {
  return <Tag className={cn(cardClass, "p-4 sm:p-5", className)} {...props} />
}

/** Title row for a card or a page section. */
export function SectionHeader({
  title,
  description,
  actions,
  level = 2,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  level?: 2 | 3
  className?: string
}) {
  const Heading = level === 2 ? "h2" : "h3"
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 space-y-1">
        <Heading className={level === 2 ? "text-h3 font-semibold text-ink" : "text-body font-semibold text-ink"}>{title}</Heading>
        {description && <p className="text-small text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

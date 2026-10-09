// AI-generated with Claude Code (claude-opus-5-5), 2026-10-05
import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "./cn"
import { toneSoft, type Tone } from "./Badge"
import { AlertIcon, CheckIcon, InfoIcon, Spinner } from "./icons"

const icons: Record<Tone, ReactNode> = {
  neutral: <InfoIcon />,
  primary: <InfoIcon />,
  success: <CheckIcon />,
  warn: <AlertIcon />,
  danger: <AlertIcon />,
}

/**
 * A boxed message. `role` is NOT set by default: pass role="alert" or role="status"
 * explicitly where the message must be announced.
 */
export function Alert({
  tone = "neutral",
  title,
  className,
  children,
  icon,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone; title?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={cn("flex gap-3 rounded-card border px-4 py-3 text-small", toneSoft[tone], className)} {...props}>
      <span className="mt-0.5 shrink-0">{icon ?? icons[tone]}</span>
      <div className="min-w-0 flex-1 space-y-2">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  )
}

/** Compact inline state indicator (saved / unsaved / working / error). */
export function StatusPill({
  tone,
  busy = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { tone: Tone; busy?: boolean }) {
  return (
    <p className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-small font-medium", toneSoft[tone], className)} {...props}>
      <span className="shrink-0">{busy ? <Spinner /> : tone === "success" ? <CheckIcon size={14} /> : tone === "warn" || tone === "danger" ? <AlertIcon size={14} /> : <InfoIcon size={14} />}</span>
      <span>{children}</span>
    </p>
  )
}

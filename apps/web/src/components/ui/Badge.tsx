// AI-generated with Claude Code (claude-opus-5-5), 2026-10-05
import type { ReactNode } from "react"
import { cn } from "./cn"

export type Tone = "neutral" | "primary" | "success" | "warn" | "danger"

export const toneSoft: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-soft border-border",
  primary: "bg-primary-soft text-primary-soft-ink border-primary/25",
  success: "bg-success-soft text-success-ink border-success/25",
  warn: "bg-warn-soft text-warn-ink border-warn/30",
  danger: "bg-danger-soft text-danger-ink border-danger/25",
}

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium whitespace-nowrap", toneSoft[tone], className)}>
      {children}
    </span>
  )
}

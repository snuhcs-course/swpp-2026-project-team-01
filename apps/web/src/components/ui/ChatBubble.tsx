import type { ReactNode } from "react"
import { cn } from "./cn"
import { Spinner } from "./icons"

/**
 * One chat turn. The assistant speaks from the left on a quiet surface with an "AI" mark;
 * the user's own words sit on the right in the primary tint.
 */
export function ChatBubble({ from, name, children, note }: { from: "user" | "assistant"; name: string; children: ReactNode; note?: ReactNode }) {
  const mine = from === "user"
  return (
    <div className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
      {!mine && (
        <span aria-hidden="true" className="mt-5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[0.625rem] font-bold tracking-wide text-surface">
          AI
        </span>
      )}
      <div className={cn("flex max-w-[85%] min-w-0 flex-col", mine && "items-end")}>
        <span className="mb-1 px-1 text-caption text-muted">{name}</span>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-body",
            mine ? "rounded-tr-md bg-primary text-primary-ink" : "rounded-tl-md border border-border bg-surface text-ink",
          )}
        >
          {children}
        </div>
        {note}
      </div>
    </div>
  )
}

/** Placeholder turn shown while the assistant is working. */
export function ChatPending({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[0.625rem] font-bold tracking-wide text-surface">
        AI
      </span>
      <p className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-dashed border-border-strong px-4 py-2.5 text-small text-muted">
        <Spinner />
        {children}
      </p>
    </div>
  )
}

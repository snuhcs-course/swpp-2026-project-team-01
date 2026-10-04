import { cn } from "./cn"
import { CheckIcon } from "./icons"

/** Linear progress through a short flow. `current` is the zero-based active step. */
export function Stepper({ steps, current, label = "진행 단계", className }: { steps: string[]; current: number; label?: string; className?: string }) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex items-center gap-2 text-small">
        {steps.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo"
          return (
            <li key={step} className="flex min-w-0 items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold tabular",
                  state === "done" && "border-primary bg-primary text-primary-ink",
                  state === "current" && "border-primary bg-primary-soft text-primary-soft-ink",
                  state === "todo" && "border-border-strong text-muted",
                )}
              >
                {state === "done" ? <CheckIcon size={13} /> : i + 1}
              </span>
              <span className={cn("truncate", state === "current" ? "font-semibold text-ink" : "text-muted")}>
                {step}
                {state === "done" && <span className="sr-only"> (완료)</span>}
              </span>
              {i < steps.length - 1 && <span aria-hidden="true" className="h-px w-4 shrink-0 bg-border-strong sm:w-8" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

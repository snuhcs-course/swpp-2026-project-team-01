import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react"
import { cn } from "./cn"
import { ChevronDownIcon } from "./icons"

export const controlClass =
  "block rounded-control border border-border-strong bg-surface px-3 text-ink " +
  "placeholder:text-subtle transition-colors hover:border-muted " +
  "focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus/40 " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted aria-invalid:border-danger"

type ControlSize = "sm" | "md"
const controlSize: Record<ControlSize, string> = { sm: "min-h-9 py-1 text-small", md: "min-h-10 py-2 text-body" }
// No class-merging library: a caller-supplied width replaces the default full width.
const width = (className?: string) => (/(^|\s)(w-|basis-|flex-1)/.test(className ?? "") ? "" : "w-full")

export function Input({ className, controlSize: size = "md", ...props }: InputHTMLAttributes<HTMLInputElement> & { controlSize?: ControlSize }) {
  return <input className={cn(controlClass, controlSize[size], width(className), "tabular", className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClass, "min-h-24 w-full resize-y py-2 text-body leading-relaxed", className)} {...props} />
}

/** Native select with a consistent chevron; keeps full keyboard and screen-reader behaviour. */
export function Select({ className, wrapperClassName, controlSize: size = "md", ...props }: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string; controlSize?: ControlSize }) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select className={cn(controlClass, controlSize[size], "w-full appearance-none pr-9", className)} {...props} />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </span>
  )
}

export const labelClass = "block text-small font-medium text-ink-soft"

/**
 * Label + control + hint/error, stacked so the label never touches the value.
 * Pass `htmlFor` matching the control id, or omit it to wrap the control in the label.
 */
export function Field({
  label,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  className,
  children,
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  hintId?: string
  error?: ReactNode
  errorId?: string
  className?: string
  children: ReactNode
}) {
  const body = (
    <>
      <span className={labelClass}>{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </>
  )
  return (
    <div className={cn("min-w-0", className)}>
      {htmlFor ? (
        <>
          <label htmlFor={htmlFor} className={labelClass}>{label}</label>
          <div className="mt-1.5">{children}</div>
        </>
      ) : (
        <label className="block">{body}</label>
      )}
      {hint && <p id={hintId} className="mt-1.5 text-caption text-muted">{hint}</p>}
      {error && <p id={errorId} className="mt-1.5 text-caption font-medium text-danger">{error}</p>}
    </div>
  )
}

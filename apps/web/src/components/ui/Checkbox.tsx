import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react"
import { cn } from "./cn"

/** Native checkbox with a generous hit area; the whole row is the label. */
export function Checkbox({
  label,
  description,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("flex min-h-10 cursor-pointer items-start gap-3 rounded-control py-2 has-disabled:cursor-not-allowed has-disabled:opacity-60", className)}>
      <input type="checkbox" className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded border-border-strong disabled:cursor-not-allowed" {...props} />
      <span className="min-w-0">
        <span className="block text-body text-ink">{label}</span>
        {description && <span className="block text-caption text-muted">{description}</span>}
      </span>
    </label>
  )
}

/** A pressable chip (aria-pressed) for picking several small options such as weekdays. */
export function ToggleChip({ pressed, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-10 min-w-10 items-center justify-center rounded-control border px-2.5 text-small font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50",
        pressed
          ? "border-primary bg-primary text-primary-ink hover:bg-primary-hover"
          : "border-border-strong bg-surface text-ink-soft hover:border-primary hover:text-primary",
        className,
      )}
      {...props}
    />
  )
}

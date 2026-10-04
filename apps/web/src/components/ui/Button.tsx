import type { ButtonHTMLAttributes } from "react"
import { cn } from "./cn"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link"
export type ButtonSize = "sm" | "md" | "lg"

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-colors duration-150 select-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink shadow-card hover:bg-primary-hover disabled:hover:bg-primary",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-surface-sunken disabled:hover:bg-surface",
  ghost: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
  danger: "border border-border-strong bg-surface text-danger hover:border-danger hover:bg-danger-soft",
  link: "text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary rounded-sm",
}

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-small",
  md: "min-h-10 px-4 text-body",
  lg: "min-h-12 px-5 text-body",
}

/** Class string for anything that should look like a button (links included). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cn(base, variants[variant], variant === "link" ? "min-h-0 px-0" : sizes[size], extra)
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />
}

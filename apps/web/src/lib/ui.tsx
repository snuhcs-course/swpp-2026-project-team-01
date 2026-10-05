import { useCallback, useEffect, useId, useRef, useState } from "react"
import type { ReactNode } from "react"
import { api } from "./api"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function Notice({
  children,
  error = false,
}: {
  children: ReactNode
  error?: boolean
}) {
  return (
    <Alert
      variant={error ? "destructive" : "default"}
      role={error ? "alert" : "status"}
    >
      <AlertTitle>{error ? "Action needed" : "Update"}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
export function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
export function Submit({
  pending,
  children,
  variant,
}: {
  pending: boolean
  children: ReactNode
  variant?: React.ComponentProps<typeof Button>["variant"]
}) {
  return (
    <Button type="submit" disabled={pending} variant={variant}>
      {pending && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  )
}
export function TextField({
  label,
  description,
  ...props
}: React.ComponentProps<typeof Input> & {
  label: string
  description?: string
}) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <Field data-disabled={props.disabled} data-invalid={props["aria-invalid"]}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...props}
        id={id}
        aria-describedby={
          [props["aria-describedby"], descriptionId]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {description && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
    </Field>
  )
}
export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const keys = useRef(new Map<string, string>())
  const lock = useRef(false)
  async function run<T>(
    action: (key: string) => Promise<T>,
    success: (result: T) => void,
    identity = "action"
  ) {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError("")
    const key = keys.current.get(identity) ?? crypto.randomUUID()
    keys.current.set(identity, key)
    try {
      const result = await action(key)
      keys.current.delete(identity)
      success(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.")
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return { pending, error, run }
}
export function useResource<T>(path: string | null, token?: string) {
  const [data, setRawData] = useState<T | null>(null)
  const setData = useCallback(
    (value: T) =>
      setRawData((previous) => {
        if (
          previous &&
          value &&
          typeof previous === "object" &&
          typeof value === "object" &&
          "revision" in previous &&
          "revision" in value &&
          typeof previous.revision === "number" &&
          typeof value.revision === "number" &&
          previous.revision > value.revision
        )
          return previous
        return value
      }),
    []
  )
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [sequence, setSequence] = useState(0)
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    api<T>(path, { token, signal: controller.signal })
      .then((value) => {
        setData(value)
        setError("")
        setLoading(false)
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Please try again.")
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [path, token, sequence, setData])
  const refresh = useCallback(() => setSequence((value) => value + 1), [])
  return { data, setData, error, loading, refresh }
}
export function ErrorState({
  error,
  retry,
}: {
  error: string
  retry: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <Notice error>{error}</Notice>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}

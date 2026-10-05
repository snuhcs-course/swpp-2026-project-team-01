import { useEffect, useState } from "react"
import type {
  MeetingDetails,
  MeetingMode,
  RequestView,
} from "../../../packages/contracts/index"
import { api } from "@/lib/api"
import { Notice, Submit, TextField, useAction } from "@/lib/ui"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function Recovery({
  id,
  recoveryToken,
  onRecovered,
}: {
  id: string
  recoveryToken?: string | null
  onRecovered: (value: { request: RequestView; token: string }) => void
}) {
  const action = useAction()
  const [pendingRecovery, setPendingRecovery] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Restore request access
        </CardTitle>
        <CardDescription>
          Recovery uses the verified contact for this request. An email address
          alone does not unlock it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recoveryToken ? (
          <Button
            disabled={action.pending}
            onClick={() =>
              action.run(
                (key) =>
                  api<{ request: RequestView; token: string }>(
                    `/requests/${id}/recovery/redeem`,
                    { body: { token: recoveryToken }, idempotencyKey: key }
                  ),
                onRecovered,
                recoveryToken
              )
            }
          >
            Restore access from this protected link
          </Button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const email = String(
                new FormData(e.currentTarget).get("recoveryEmail")
              )
              action.run(
                (key) =>
                  api<{ status: string }>(`/requests/${id}/recover`, {
                    body: { email },
                    idempotencyKey: key,
                  }),
                () => setPendingRecovery(true),
                email
              )
            }}
          >
            <FieldGroup>
              <TextField
                name="recoveryEmail"
                label="Request email address"
                type="email"
                autoComplete="email"
                required
              />
              {pendingRecovery && (
                <Notice>
                  If these details match an active request, recovery delivery is
                  pending. Check your email for a protected link.
                </Notice>
              )}
              <Submit pending={action.pending}>Request a recovery link</Submit>
            </FieldGroup>
          </form>
        )}
        {action.error && <Notice error>{action.error}</Notice>}
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">
          A redeemed recovery link replaces the previous continuation
          credential.
        </p>
      </CardFooter>
    </Card>
  )
}
export function Verification({
  request,
  token,
  onChanged,
}: {
  request: RequestView
  token?: string
  onChanged: (value: RequestView) => void
}) {
  const action = useAction()
  const [started, setStarted] = useState(false)
  const [code, setCode] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("verify") ?? ""
  )
  useEffect(() => {
    const clearCodeFragment = () => {
      const fragment = new URLSearchParams(location.hash.slice(1))
      fragment.delete("verify")
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}${fragment.size ? `#${fragment}` : ""}`
      )
    }
    const receiveCode = () => {
      const incoming = new URLSearchParams(location.hash.slice(1)).get("verify")
      if (incoming) {
        setCode(incoming)
        clearCodeFragment()
      }
    }
    if (new URLSearchParams(location.hash.slice(1)).has("verify"))
      clearCodeFragment()
    window.addEventListener("hashchange", receiveCode)
    return () => window.removeEventListener("hashchange", receiveCode)
  }, [])
  if (request.contactVerified)
    return <Badge variant="secondary">Contact verified</Badge>
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Verify your contact
        </CardTitle>
        <CardDescription>
          Confirm access to {request.details.requesterEmail} before agreeing to
          a proposal.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button
          variant="outline"
          disabled={action.pending}
          onClick={() =>
            action.run(
              (key) =>
                api<{ status: "pending"; request: RequestView }>(
                  `/requests/${request.id}/verification/start`,
                  {
                    token,
                    idempotencyKey: key,
                    body: { expectedRevision: request.revision },
                  }
                ),
              (value) => {
                onChanged(value.request)
                setStarted(true)
              },
              `start-${request.revision}`
            )
          }
        >
          {started
            ? "Request another verification code"
            : "Request verification code"}
        </Button>
        {started && (
          <Notice>
            Verification delivery is pending. Check your email for the code;
            this request stays open if delivery is delayed.
          </Notice>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            action.run(
              (key) =>
                api<RequestView>(
                  `/requests/${request.id}/verification/confirm`,
                  {
                    token,
                    idempotencyKey: key,
                    body: { code, expectedRevision: request.revision },
                  }
                ),
              (value) => {
                onChanged(value)
                setCode("")
              },
              JSON.stringify([code, request.revision])
            )
          }}
        >
          <FieldGroup>
            <TextField
              name="verificationCode"
              label="Verification code"
              required
              autoComplete="one-time-code"
              description="Paste the complete case-sensitive code from your email."
              autoCapitalize="none"
              spellCheck={false}
              pattern="[A-Za-z0-9_-]{43}"
              minLength={43}
              maxLength={43}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Submit pending={action.pending}>Verify contact</Submit>
          </FieldGroup>
        </form>
        {action.error && <Notice error>{action.error}</Notice>}
      </CardContent>
    </Card>
  )
}
function browserDatetime(value: string) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
export function DetailsEditor({
  request,
  pending,
  mutate,
}: {
  request: RequestView
  pending: boolean
  mutate: (
    operation: string,
    body?: Record<string, unknown>,
    after?: (value: RequestView) => void
  ) => void
}) {
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<MeetingMode>(request.details.mode)
  const [windows, setWindows] = useState(
    request.details.windows.map((window) => ({
      start: browserDatetime(window.start),
      end: browserDatetime(window.end),
    }))
  )
  const [error, setError] = useState("")
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Update your request
        </CardTitle>
        <CardDescription>
          Add a wider window or change shared details. Changes clear applicable
          agreement and approval, and a new proposal needs review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <Button
            variant="outline"
            onClick={() => setEditing(true)}
            aria-expanded={false}
          >
            Edit details and availability
          </Button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              const read = (name: string) => String(form.get(name) ?? "")
              try {
                new Intl.DateTimeFormat("en", {
                  timeZone: read("editTimezone"),
                })
                const parsed = windows.map((window) => ({
                  start: new Date(window.start).toISOString(),
                  end: new Date(window.end).toISOString(),
                }))
                if (
                  parsed.some(
                    (window) =>
                      Date.parse(window.start) <= Date.now() ||
                      Date.parse(window.end) - Date.parse(window.start) <
                        request.details.durationMinutes * 60000
                  )
                )
                  throw new Error(
                    "Choose future windows long enough for the meeting."
                  )
                const details: MeetingDetails = {
                  requesterName: read("editName"),
                  requesterEmail: read("editEmail"),
                  purpose: read("editPurpose"),
                  durationMinutes: request.details.durationMinutes,
                  timezone: read("editTimezone"),
                  mode,
                  location: read("editLocation"),
                  windows: parsed,
                }
                setError("")
                mutate("details", { details }, () => setEditing(false))
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Check the availability you entered."
                )
              }
            }}
          >
            <FieldGroup>
              <TextField
                name="editName"
                label="Your name"
                defaultValue={request.details.requesterName}
                required
                maxLength={100}
              />
              <TextField
                name="editEmail"
                label="Email address"
                type="email"
                defaultValue={request.details.requesterEmail}
                required
                maxLength={254}
              />
              <Field>
                <FieldLabel htmlFor="editPurpose">Meeting purpose</FieldLabel>
                <Textarea
                  id="editPurpose"
                  name="editPurpose"
                  defaultValue={request.details.purpose}
                  required
                  maxLength={4000}
                  minLength={5}
                />
              </Field>
              <TextField
                name="editTimezone"
                label="Display timezone"
                defaultValue={request.details.timezone}
                required
              />
              <Field>
                <FieldLabel id="editMode">Meeting mode</FieldLabel>
                <ToggleGroup
                  value={[mode]}
                  onValueChange={(values) => {
                    if (values[0]) setMode(values[0] as MeetingMode)
                  }}
                  aria-labelledby="editMode"
                  spacing={2}
                >
                  <ToggleGroupItem value="online">Online</ToggleGroupItem>
                  <ToggleGroupItem value="in_person">In person</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <TextField
                name="editLocation"
                label="Location or meeting link"
                defaultValue={request.details.location}
                required={mode === "in_person"}
                maxLength={1000}
              />
              <FieldSet>
                <FieldLegend>Availability windows</FieldLegend>
                <FieldDescription>
                  Enter times in your browser timezone,{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                </FieldDescription>
                <FieldGroup>
                  {windows.map((window, i) => (
                    <FieldGroup key={i}>
                      <FieldGroup className="sm:flex-row">
                        <TextField
                          name={`edit-start-${i}`}
                          label={`Window ${i + 1} starts`}
                          type="datetime-local"
                          value={window.start}
                          required
                          onChange={(e) =>
                            setWindows((values) =>
                              values.map((item, index) =>
                                index === i
                                  ? { ...item, start: e.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <TextField
                          name={`edit-end-${i}`}
                          label={`Window ${i + 1} ends`}
                          type="datetime-local"
                          value={window.end}
                          required
                          onChange={(e) =>
                            setWindows((values) =>
                              values.map((item, index) =>
                                index === i
                                  ? { ...item, end: e.target.value }
                                  : item
                              )
                            )
                          }
                        />
                      </FieldGroup>
                      {windows.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setWindows((values) =>
                              values.filter((_item, index) => index !== i)
                            )
                          }
                        >
                          Remove window {i + 1}
                        </Button>
                      )}
                    </FieldGroup>
                  ))}
                  {windows.length < 8 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setWindows((values) => [
                          ...values,
                          { start: "", end: "" },
                        ])
                      }
                    >
                      Add a window
                    </Button>
                  )}
                </FieldGroup>
              </FieldSet>
              {error && <Notice error>{error}</Notice>}
              <Submit pending={pending}>Save updated details</Submit>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Keep current details
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

export function PrivateTravel({
  request,
  pending,
  mutate,
}: {
  request: RequestView
  pending: boolean
  mutate: (
    operation: string,
    body?: Record<string, unknown>,
    after?: (value: RequestView) => void
  ) => void
}) {
  const privateView = request as RequestView & {
    privateSchedulingContext?: {
      physicalContext?: { at: string; location: string }[]
      candidatePhysicalLocation?: string
    }
    privateDiagnostics?: { code: string }[]
  }
  const context = privateView.privateSchedulingContext
  const [editing, setEditing] = useState(false)
  const [points, setPoints] = useState(
    (context?.physicalContext ?? []).map((point) => ({
      at: browserDatetime(point.at),
      location: point.location,
    }))
  )
  const [error, setError] = useState("")
  const [edge, setEdge] = useState("before")
  const [confirmed, setConfirmed] = useState(false)
  const [manualStart, setManualStart] = useState(
    request.proposal ? browserDatetime(request.proposal.start) : ""
  )
  const [manualEnd, setManualEnd] = useState(
    request.proposal ? browserDatetime(request.proposal.end) : ""
  )
  const [minutes, setMinutes] = useState("")
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <Card>
      <CardHeader>
        <Badge variant="secondary">Only you can see this</Badge>
        <CardTitle role="heading" aria-level={2}>
          Travel and physical whereabouts
        </CardTitle>
        <CardDescription>
          For an in-person meeting—or an online call between trips—confirm where
          you’ll be. A missing route needs clarification or a specific
          allowance.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {privateView.privateDiagnostics?.some(
          (item) => item.code.includes("unknown") || item.code.includes("route")
        ) && (
          <Notice>
            Some travel checks need more information. Confirm your locations or
            review a specific manual travel allowance below.
          </Notice>
        )}
        {!editing ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Review private travel details
          </Button>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const form = new FormData(e.currentTarget)
                try {
                  const physicalContext = points.map((point) => ({
                    at: new Date(point.at).toISOString(),
                    location: point.location.trim(),
                  }))
                  setError("")
                  mutate(
                    "context",
                    {
                      physicalContext,
                      candidatePhysicalLocation: String(
                        form.get("physicalLocation") ?? ""
                      ),
                    },
                    () => setEditing(false)
                  )
                } catch {
                  setError(
                    "Enter a valid time and location for every physical whereabouts point."
                  )
                }
              }}
            >
              <FieldGroup>
                <TextField
                  name="physicalLocation"
                  label="Where you’ll physically be during this meeting"
                  description="For an online call, this is your location, not the meeting URL. It stays private."
                  defaultValue={context?.candidatePhysicalLocation ?? ""}
                  maxLength={500}
                />
                <FieldSet>
                  <FieldLegend>
                    Confirmed whereabouts near the meeting
                  </FieldLegend>
                  <FieldDescription>
                    Enter locations before or after the meeting, with timestamps
                    in {timezone}. These complement calendar commitments.
                  </FieldDescription>
                  <FieldGroup>
                    {points.map((point, i) => (
                      <FieldGroup key={i}>
                        <TextField
                          name={`where-time-${i}`}
                          label={`Location ${i + 1} at`}
                          type="datetime-local"
                          required
                          value={point.at}
                          onChange={(e) =>
                            setPoints((values) =>
                              values.map((item, index) =>
                                index === i
                                  ? { ...item, at: e.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <TextField
                          name={`where-location-${i}`}
                          label={`Location ${i + 1} address`}
                          required
                          maxLength={500}
                          value={point.location}
                          onChange={(e) =>
                            setPoints((values) =>
                              values.map((item, index) =>
                                index === i
                                  ? { ...item, location: e.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setPoints((values) =>
                              values.filter((_item, index) => index !== i)
                            )
                          }
                        >
                          Remove location {i + 1}
                        </Button>
                      </FieldGroup>
                    ))}
                    {points.length < 10 && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setPoints((values) => [
                            ...values,
                            { at: "", location: "" },
                          ])
                        }
                      >
                        Add a confirmed location
                      </Button>
                    )}
                  </FieldGroup>
                </FieldSet>
                <Submit pending={pending}>Save private whereabouts</Submit>
              </FieldGroup>
            </form>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                try {
                  const start = new Date(manualStart).toISOString()
                  const end = new Date(manualEnd).toISOString()
                  if (Date.parse(end) <= Date.parse(start))
                    throw new Error("Choose a meeting end after the start.")
                  setError("")
                  mutate(
                    "travel-allowances",
                    {
                      start,
                      end,
                      edge,
                      durationMinutes: Number(minutes),
                      confirmed: true,
                    },
                    () => setConfirmed(false)
                  )
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Check the meeting time."
                  )
                }
              }}
            >
              <FieldGroup>
                <FieldSet>
                  <FieldLegend>Confirm a manual travel allowance</FieldLegend>
                  <FieldDescription>
                    Use this only when you can confirm the travel time for a
                    particular meeting and trip. Calendar conflicts and buffers
                    still apply.
                  </FieldDescription>
                  <FieldGroup className="sm:flex-row">
                    <TextField
                      name="allowance-start"
                      label="Meeting starts"
                      type="datetime-local"
                      required
                      value={manualStart}
                      onChange={(e) => {
                        setManualStart(e.target.value)
                        setConfirmed(false)
                      }}
                    />
                    <TextField
                      name="allowance-end"
                      label="Meeting ends"
                      type="datetime-local"
                      required
                      value={manualEnd}
                      onChange={(e) => {
                        setManualEnd(e.target.value)
                        setConfirmed(false)
                      }}
                    />
                  </FieldGroup>
                  <Field>
                    <FieldLabel id="travel-edge">Which trip?</FieldLabel>
                    <ToggleGroup
                      value={[edge]}
                      aria-labelledby="travel-edge"
                      spacing={2}
                      onValueChange={(values) => {
                        if (values[0]) {
                          setEdge(values[0])
                          setConfirmed(false)
                        }
                      }}
                    >
                      <ToggleGroupItem value="before">
                        To the meeting
                      </ToggleGroupItem>
                      <ToggleGroupItem value="after">
                        After the meeting
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                  <TextField
                    name="allowance-minutes"
                    label="Confirmed travel time (minutes)"
                    type="number"
                    min={1}
                    max={1440}
                    required
                    value={minutes}
                    onChange={(e) => {
                      setMinutes(e.target.value)
                      setConfirmed(false)
                    }}
                  />
                  <Field orientation="horizontal">
                    <Checkbox
                      id="allowance-confirm"
                      checked={confirmed}
                      onCheckedChange={(value) => setConfirmed(value === true)}
                    />
                    <FieldLabel htmlFor="allowance-confirm">
                      I confirm {minutes || "the entered"} minutes for the trip{" "}
                      {edge === "before" ? "to" : "after"} this specific
                      meeting.
                    </FieldLabel>
                  </Field>
                </FieldSet>
                <Button type="submit" disabled={!confirmed || pending}>
                  Confirm specific travel allowance
                </Button>
              </FieldGroup>
            </form>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Close travel details
            </Button>
          </>
        )}
        {error && <Notice error>{error}</Notice>}
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">
          Saved travel details trigger a fresh feasibility check. They cannot
          override a busy calendar.
        </p>
      </CardFooter>
    </Card>
  )
}

export function PreferenceException({
  request,
  mutable,
  pending,
  mutate,
}: {
  request: RequestView
  mutable: boolean
  pending: boolean
  mutate: (operation: string, body?: Record<string, unknown>) => void
}) {
  const privateView = request as RequestView & {
    privateSchedulingContext?: {
      preferenceException?: {
        proposalVersion: number
        rulesVersion: number
        reason: string
      }
    }
  }
  const exception = privateView.privateSchedulingContext?.preferenceException
  const saved =
    exception?.proposalVersion === request.proposal?.version
      ? exception
      : undefined
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  if (!request.proposal) return null
  return (
    <Card>
      <CardHeader>
        <Badge variant="secondary">Only you can see this</Badge>
        <CardTitle role="heading" aria-level={2}>
          Private preference exception
        </CardTitle>
        <CardDescription>
          Make a deliberate exception to a soft preference for this proposal.
          Busy calendar conflicts, required duration, and travel buffers still
          apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {saved && (
          <Notice>
            Saved for proposal {saved.proposalVersion}, rules version{" "}
            {saved.rulesVersion}: {saved.reason}
          </Notice>
        )}
        {mutable && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!confirmed || !reason.trim() || pending) return
              mutate("preference-exception", {
                proposalVersion: request.proposal!.version,
                confirmed: true,
                reason: reason.trim(),
              })
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="exception-reason">
                  Private reason for this preference exception
                </FieldLabel>
                <Textarea
                  id="exception-reason"
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    setConfirmed(false)
                  }}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="exception-confirm"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                <FieldLabel htmlFor="exception-confirm">
                  I confirm this private preference exception for proposal{" "}
                  {request.proposal.version} with these exact details.
                </FieldLabel>
              </Field>
              <Button
                type="submit"
                disabled={!confirmed || !reason.trim() || pending}
              >
                Confirm preference exception
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">
          Saving checks the current proposal and rules. It does not approve a
          booking; final approval remains a separate action.
        </p>
      </CardFooter>
    </Card>
  )
}

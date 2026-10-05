import { useEffect, useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import type {
  CalendarOption,
  HostRules,
  SetupState,
} from "../../../packages/contracts/index"
import { api, configured, supabase } from "@/lib/api"
import {
  ErrorState,
  Loading,
  Notice,
  Submit,
  TextField,
  useAction,
  useResource,
} from "@/lib/ui"
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
  FieldSeparator,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { WorkspaceShell } from "@/components/workspace-shell"
import { ServiceNotices } from "@/components/service-notices"
import { cn } from "@/lib/utils"
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact"
import {
  SetupConversation,
  captureIMessageContinuation,
} from "./SetupConversation"
import {
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock3,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const defaults: HostRules = {
  timezone: localZone,
  durationMinutes: 30,
  availability: [{ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }],
  focusBlocks: [],
  bufferMinutes: 15,
  travelMode: "TRANSIT",
  preferences: "",
}

export function Host({ children }: { children?: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  useEffect(() => {
    captureIMessageContinuation()
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  if (loading)
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-10">
        <Loading />
      </main>
    )
  if (!session) return <SignIn />
  return (
    <WorkspaceShell
      email={session.user.email ?? "Host account"}
      onSignOut={async () => {
        await supabase?.auth.signOut()
      }}
    >
      {children ?? <Workspace />}
    </WorkspaceShell>
  )
}
function SignIn() {
  const action = useAction()
  const googleAction = useAction()
  const [redirecting, setRedirecting] = useState(false)
  const busy = action.pending || googleAction.pending || redirecting
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState("")
  return (
    <main
      id="main"
      className="flex min-h-svh items-center justify-center bg-muted p-5 md:p-10"
    >
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <ServiceNotices />
        <Card className="w-full p-0">
          <CardContent className="grid p-0 md:grid-cols-2">
            <div className="flex flex-col gap-6 p-6 md:p-8">
              <div className="flex flex-col gap-3">
                <a href="/" className="flex items-center gap-2 font-semibold">
                  <CalendarCheck2 aria-hidden="true" className="size-5" />
                  Find Me a Time
                </a>
                <Badge variant="secondary">Host access</Badge>
                <div className="flex flex-col gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Welcome back.
                  </h1>
                  <p className="text-muted-foreground">
                    Sign in to set your boundaries, connect calendars, and
                    review meeting requests. Hosting is invite-only.
                  </p>
                </div>
              </div>
              <FieldGroup>
                <Field>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      googleAction.run(
                        async () => {
                          if (!supabase)
                            throw new Error(
                              "Sign-in is being configured. Please try again later."
                            )
                          const { error } = await supabase.auth.signInWithOAuth(
                            {
                              provider: "google",
                              options: {
                                redirectTo: `${location.origin}/host`,
                              },
                            }
                          )
                          if (error) throw error
                        },
                        () => setRedirecting(true)
                      )
                    }
                  >
                    {(googleAction.pending || redirecting) && (
                      <Spinner data-icon="inline-start" />
                    )}
                    Continue with Google
                  </Button>
                  <FieldDescription>
                    Google sign-in verifies your identity. Calendar access is a
                    separate step after your invitation is accepted.
                  </FieldDescription>
                </Field>
                {googleAction.error && (
                  <Notice error>{googleAction.error}</Notice>
                )}
                <FieldSeparator>Or use email</FieldSeparator>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (busy) return
                    action.run(
                      async () => {
                        if (!supabase)
                          throw new Error(
                            "Sign-in is being configured. Please try again later."
                          )
                        const { error } = await supabase.auth.signInWithOtp({
                          email,
                          options: {
                            emailRedirectTo: `${location.origin}/host${location.search}`,
                            shouldCreateUser: true,
                          },
                        })
                        if (error) throw error
                      },
                      () => setSent(true)
                    )
                  }}
                >
                  <FieldGroup>
                    <TextField
                      name="email"
                      label="Email address"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    {sent && (
                      <Notice>
                        Check your email for a secure sign-in link. You can
                        return here after opening it.
                      </Notice>
                    )}
                    {action.error && <Notice error>{action.error}</Notice>}
                    <Submit pending={busy} variant="outline">
                      Email me a sign-in link
                    </Submit>
                  </FieldGroup>
                </form>
                <FieldDescription className="text-center">
                  Requesting a meeting through a host link does not require
                  sign-in.
                </FieldDescription>
              </FieldGroup>
            </div>
            <div className="hidden flex-col justify-between gap-10 bg-muted p-8 md:flex">
              <div className="flex flex-col gap-4">
                <Sparkles aria-hidden="true" className="size-8" />
                <div className="flex flex-col gap-2">
                  <p className="text-lg font-medium">
                    Your calendar, your call.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Find Me a Time handles the coordination while every booking
                    stays under your control.
                  </p>
                </div>
              </div>
              <ol className="flex flex-col gap-5">
                <SignInBenefit
                  icon={<Clock3 aria-hidden="true" />}
                  title="Set your rules"
                  description="Choose when, where, and how long you want to meet."
                />
                <SignInBenefit
                  icon={<CalendarCheck2 aria-hidden="true" />}
                  title="Protect busy time"
                  description="Select the calendars that should count as conflicts."
                />
                <SignInBenefit
                  icon={<ShieldCheck aria-hidden="true" />}
                  title="Approve every meeting"
                  description="Nothing is booked until you explicitly approve it."
                />
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function SignInBenefit({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5" aria-hidden="true">
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </li>
  )
}
function Workspace() {
  const resource = useResource<SetupState>("/host/setup")
  if (resource.loading) return <Loading />
  if (resource.error || !resource.data)
    return (
      <ErrorState
        error={resource.error || "Setup could not be loaded."}
        retry={resource.refresh}
      />
    )
  return (
    <div className="mx-auto w-full max-w-4xl">
      <SetupConversation
        initial={resource.data}
        onSaved={resource.setData}
        statusArtifact={<ReadinessChecklist setup={resource.data} />}
        protectedActions={
          resource.data.admitted ? (
            resource.data.profile &&
            resource.data.rules &&
            !resource.data.profile.ready ? (
              <CalendarSetup
                initial={resource.data}
                onSaved={resource.setData}
              />
            ) : null
          ) : (
            <Admission onSaved={resource.setData} />
          )
        }
        recovery={<Setup initial={resource.data} onSaved={resource.setData} />}
      />
    </div>
  )
}

function ReadinessChecklist({ setup }: { setup: SetupState }) {
  const calendarsSelected =
    setup.conflictCalendarIds.length > 0 && Boolean(setup.bookingCalendarId)
  const steps = [
    {
      title: "Invitation accepted",
      description: setup.admitted
        ? "Your host access is active."
        : "Redeem the invitation sent to your verified email.",
      complete: setup.admitted,
    },
    {
      title: "Profile and rules saved",
      description:
        setup.profile && setup.rules
          ? "Your public name and scheduling boundaries are saved."
          : "Add your booking link, availability, and preferences.",
      complete: Boolean(setup.profile && setup.rules),
    },
    {
      title: "Google Calendar connected",
      description: setup.calendarConnected
        ? "Calendar access is active."
        : "Connect Google so busy times can be checked.",
      complete: setup.calendarConnected,
    },
    {
      title: "Calendars selected",
      description: calendarsSelected
        ? "Conflict and booking calendars are set."
        : "Choose calendars to protect and a destination for bookings.",
      complete: calendarsSelected,
    },
    {
      title: "Booking link published",
      description: setup.profile?.ready
        ? "Your link is ready to receive requests."
        : "Complete every setup step before sharing your link.",
      complete: setup.profile?.ready ?? false,
    },
  ]
  const completeCount = steps.filter((step) => step.complete).length

  return (
    <Artifact>
      <ArtifactHeader>
        <div className="flex flex-col gap-1">
          <ArtifactTitle>Setup progress</ArtifactTitle>
          <ArtifactDescription>
            {completeCount} of {steps.length} steps complete.{" "}
            {setup.profile?.ready
              ? "You’re ready to receive meeting requests."
              : "Connecting Google alone does not publish your booking link."}
          </ArtifactDescription>
        </div>
      </ArtifactHeader>
      <ArtifactContent>
        <ol
          className={cn(
            "grid gap-4 sm:grid-cols-2 xl:grid-cols-5",
            setup.profile?.ready && "grid-cols-2"
          )}
        >
          {steps.map((step) => (
            <li key={step.title} className="flex gap-3">
              {step.complete ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0"
                />
              ) : (
                <CircleDashed
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
              )}
              <div className="flex flex-col gap-1">
                <p className="font-medium">{step.title}</p>
                <p
                  className={cn(
                    "text-xs leading-relaxed text-muted-foreground",
                    setup.profile?.ready && "hidden sm:block"
                  )}
                >
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </ArtifactContent>
    </Artifact>
  )
}
function Admission({ onSaved }: { onSaved: (value: SetupState) => void }) {
  const [token, setToken] = useState(
    new URLSearchParams(location.search).get("invite") ?? ""
  )
  const action = useAction()
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          A spot for your calendar
        </CardTitle>
        <CardDescription>
          Redeem the invitation sent to your verified email address to start
          hosting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            action.run(
              (key) =>
                api<SetupState>("/host/invitations/redeem", {
                  body: { token },
                  idempotencyKey: key,
                }),
              onSaved,
              token
            )
          }}
        >
          <FieldGroup>
            <TextField
              name="invitation"
              label="Invitation code"
              description="Enter the 16-character code, for example XXXX-XXXX-XXXX-XXXX."
              placeholder="XXXX-XXXX-XXXX-XXXX"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            {action.error && <Notice error>{action.error}</Notice>}
            <Submit pending={action.pending}>Redeem invitation</Submit>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          render={<a href="/#waitlist" />}
          nativeButton={false}
        >
          Join the waitlist
        </Button>
      </CardFooter>
    </Card>
  )
}
function Setup({
  initial,
  onSaved,
}: {
  initial: SetupState
  onSaved: (value: SetupState) => void
}) {
  const rules = initial.rules ?? defaults
  const [days, setDays] = useState(
    rules.availability[0]?.days ?? [1, 2, 3, 4, 5]
  )
  const action = useAction()
  const [saved, setSaved] = useState(false)
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Your scheduling rules
          </CardTitle>
          <CardDescription>
            Define the details requesters can use and the private boundaries we
            should protect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              const string = (name: string) => String(form.get(name) ?? "")
              const start = string("start")
              const end = string("end")
              action.run(
                (key) => {
                  if (!days.length || start >= end)
                    throw new Error(
                      "Choose at least one day and an end time after the start time."
                    )
                  const zone = string("timezone")
                  new Intl.DateTimeFormat("en", { timeZone: zone })
                  const focusStart = string("focusStart")
                  const focusEnd = string("focusEnd")
                  if (Boolean(focusStart) !== Boolean(focusEnd))
                    throw new Error(
                      "Enter both a start and end for the focus block."
                    )
                  if (focusStart && new Date(focusEnd) <= new Date(focusStart))
                    throw new Error("Choose a focus block end after the start.")
                  const focusBlocks =
                    focusStart && focusEnd
                      ? [
                          {
                            start: new Date(focusStart).toISOString(),
                            end: new Date(focusEnd).toISOString(),
                          },
                        ]
                      : rules.focusBlocks
                  return api<SetupState>("/host/setup", {
                    idempotencyKey: key,
                    body: {
                      handle: string("handle"),
                      displayName: string("displayName"),
                      rules: {
                        timezone: zone,
                        durationMinutes: Number(form.get("duration")),
                        availability: [{ days, start, end }],
                        focusBlocks,
                        bufferMinutes: Number(form.get("buffer")),
                        travelMode: string("travelMode"),
                        homeLocation: string("homeLocation"),
                        preferences: string("preferences"),
                      },
                    },
                  })
                },
                (value) => {
                  onSaved(value)
                  setSaved(true)
                },
                JSON.stringify([...form.entries(), days])
              )
            }}
          >
            <FieldGroup>
              <FieldSet>
                <FieldLegend className="flex items-center gap-2">
                  <Sparkles aria-hidden="true" className="size-4" />
                  Booking identity
                </FieldLegend>
                <FieldDescription>
                  These details appear on the request page you share.
                </FieldDescription>
                <FieldGroup>
                  <FieldGroup className="sm:flex-row">
                    <TextField
                      name="displayName"
                      label="Display name"
                      required
                      defaultValue={initial.profile?.displayName ?? ""}
                      autoComplete="name"
                    />
                    <TextField
                      name="handle"
                      label="Booking link handle"
                      description="Your public link: findmeatime.com/your-handle"
                      pattern="[a-z0-9][a-z0-9-]{2,29}"
                      minLength={3}
                      maxLength={30}
                      required
                      defaultValue={initial.profile?.handle ?? ""}
                    />
                  </FieldGroup>
                  <TextField
                    name="timezone"
                    label="Timezone"
                    description="Use a location timezone, such as Asia/Seoul or America/New_York."
                    required
                    defaultValue={rules.timezone}
                  />
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend className="flex items-center gap-2">
                  <CalendarClock aria-hidden="true" className="size-4" />
                  Availability
                </FieldLegend>
                <FieldDescription>
                  Set your usual meeting window. Busy calendar events and focus
                  blocks are checked separately.
                </FieldDescription>
                <FieldGroup>
                  <TextField
                    name="duration"
                    label="Default meeting length (minutes)"
                    type="number"
                    min={5}
                    max={240}
                    step={5}
                    required
                    defaultValue={rules.durationMinutes}
                  />
                  <Field>
                    <FieldLabel id="days-label">Available days</FieldLabel>
                    <ToggleGroup
                      multiple
                      value={days.map(String)}
                      onValueChange={(values) => setDays(values.map(Number))}
                      aria-labelledby="days-label"
                      spacing={1}
                      className="flex-wrap"
                    >
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (day, i) => (
                          <ToggleGroupItem
                            key={day}
                            value={String(i)}
                            aria-label={day}
                          >
                            {day}
                          </ToggleGroupItem>
                        )
                      )}
                    </ToggleGroup>
                  </Field>
                  <FieldGroup className="sm:flex-row">
                    <TextField
                      name="start"
                      label="Available from"
                      type="time"
                      required
                      defaultValue={rules.availability[0]?.start ?? "09:00"}
                    />
                    <TextField
                      name="end"
                      label="Until"
                      type="time"
                      required
                      defaultValue={rules.availability[0]?.end ?? "17:00"}
                    />
                  </FieldGroup>
                  <TextField
                    name="buffer"
                    label="Buffer between meetings (minutes)"
                    type="number"
                    min={0}
                    max={180}
                    required
                    defaultValue={rules.bufferMinutes}
                  />
                  <FieldSet>
                    <FieldLegend variant="label">
                      Protect focus time (optional)
                    </FieldLegend>
                    <FieldDescription>
                      These timestamps use your browser timezone, {localZone}.
                      Existing focus blocks are retained unless you enter a
                      replacement.
                    </FieldDescription>
                    <FieldGroup className="sm:flex-row">
                      <TextField
                        name="focusStart"
                        label="Focus block starts"
                        type="datetime-local"
                      />
                      <TextField
                        name="focusEnd"
                        label="Focus block ends"
                        type="datetime-local"
                      />
                    </FieldGroup>
                  </FieldSet>
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend className="flex items-center gap-2">
                  <MapPin aria-hidden="true" className="size-4" />
                  Travel and preferences
                </FieldLegend>
                <FieldDescription>
                  These details stay private and help evaluate in-person
                  requests.
                </FieldDescription>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="travelMode">Travel mode</FieldLabel>
                    <NativeSelect
                      name="travelMode"
                      id="travelMode"
                      defaultValue={rules.travelMode}
                    >
                      {[
                        ["TRANSIT", "Public transport"],
                        ["DRIVE", "Driving"],
                        ["WALK", "Walking"],
                        ["BICYCLE", "Bicycle"],
                      ].map(([value, label]) => (
                        <NativeSelectOption value={value} key={value}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <TextField
                    name="homeLocation"
                    label="Usual location (private, optional)"
                    defaultValue={rules.homeLocation ?? ""}
                  />
                  <Field>
                    <FieldLabel htmlFor="preferences">
                      Preferences (private)
                    </FieldLabel>
                    <Textarea
                      name="preferences"
                      id="preferences"
                      defaultValue={rules.preferences}
                      placeholder="Anything you would like considered when reviewing requests"
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
              {action.error && <Notice error>{action.error}</Notice>}
              {saved && <Notice>Your settings have been saved.</Notice>}
              <Submit pending={action.pending}>Confirm and save rules</Submit>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            Every meeting still needs your explicit approval.
          </p>
        </CardFooter>
      </Card>
      <CalendarSetup initial={initial} onSaved={onSaved} />
    </div>
  )
}
function CalendarSetup({
  initial,
  onSaved,
}: {
  initial: SetupState
  onSaved: (value: SetupState) => void
}) {
  const action = useAction()
  const calendars = useResource<{ calendars: CalendarOption[] }>(
    initial.calendarConnected ? "/host/calendars" : null
  )
  const [conflictIds, setConflictIds] = useState(initial.conflictCalendarIds)
  const [bookingId, setBookingId] = useState(initial.bookingCalendarId ?? "")
  const calendarLabel = (calendar: CalendarOption) =>
    calendars.data?.calendars.filter(
      (value) => value.summary === calendar.summary
    ).length !== 1
      ? `${calendar.summary} (${calendar.primary ? "primary" : calendar.id})`
      : calendar.summary
  const calendarSelectionSaved =
    initial.conflictCalendarIds.length > 0 && Boolean(initial.bookingCalendarId)
  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Your calendars
        </CardTitle>
        <CardDescription>
          Choose calendars to check for conflicts and one writable calendar for
          confirmed bookings. A Google connection is only the first step.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Badge variant={calendarSelectionSaved ? "default" : "secondary"}>
          {calendarSelectionSaved
            ? "Calendar selection saved"
            : initial.calendarConnected
              ? "Connected — choose calendars"
              : "Calendar connection needed"}
        </Badge>
        {initial.profile?.ready && (
          <Notice>
            Your booking link is ready:{" "}
            <a
              href={`/${initial.profile.handle}`}
              className="break-all underline"
            >
              {location.origin}/{initial.profile.handle}
            </a>
          </Notice>
        )}
        {initial.calendarConnected && calendars.loading && <Loading />}
        {calendars.error && (
          <ErrorState error={calendars.error} retry={calendars.refresh} />
        )}
        {initial.calendarConnected && calendars.data && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              action.run(
                (key) =>
                  api<SetupState>("/host/calendar-settings", {
                    idempotencyKey: key,
                    body: {
                      conflictCalendarIds: conflictIds,
                      bookingCalendarId: bookingId,
                    },
                  }),
                onSaved,
                JSON.stringify([conflictIds, bookingId])
              )
            }}
          >
            <FieldGroup>
              <FieldSet>
                <FieldLegend>Conflict calendars</FieldLegend>
                <FieldDescription>
                  Busy times on selected calendars are protected.
                </FieldDescription>
                <FieldGroup>
                  {calendars.data.calendars.map((calendar) => (
                    <Field orientation="horizontal" key={calendar.id}>
                      <Checkbox
                        id={`calendar-${calendar.id}`}
                        checked={conflictIds.includes(calendar.id)}
                        onCheckedChange={(checked) =>
                          setConflictIds((value) =>
                            checked
                              ? [...value, calendar.id]
                              : value.filter((id) => id !== calendar.id)
                          )
                        }
                      />
                      <FieldLabel htmlFor={`calendar-${calendar.id}`}>
                        {calendarLabel(calendar)}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="bookingCalendar">
                  Booking destination
                </FieldLabel>
                <NativeSelect
                  id="bookingCalendar"
                  required
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                >
                  <NativeSelectOption value="">
                    Choose a writable calendar
                  </NativeSelectOption>
                  {calendars.data.calendars
                    .filter((c) => ["owner", "writer"].includes(c.accessRole))
                    .map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {calendarLabel(c)}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
              <Submit pending={action.pending}>Save calendar selection</Submit>
            </FieldGroup>
          </form>
        )}
        {action.error && <Notice error>{action.error}</Notice>}
        <Button
          disabled={action.pending || !configured}
          onClick={() =>
            action.run(
              (key) =>
                api<{ url: string }>("/host/google/connect", {
                  body: {},
                  idempotencyKey: key,
                }),
              (value) => {
                location.assign(value.url)
              }
            )
          }
        >
          {initial.calendarConnected
            ? "Reconnect Google Calendar"
            : "Connect Google Calendar"}
        </Button>
        {initial.calendarConnected && (
          <Button
            variant="outline"
            disabled={action.pending}
            onClick={() =>
              action.run(
                (key) =>
                  api<SetupState>("/host/calendar/disconnect", {
                    body: {},
                    idempotencyKey: key,
                  }),
                onSaved,
                "disconnect"
              )
            }
          >
            Disconnect calendar access
          </Button>
        )}
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">
          A connection error requires reconnection. Your calendar is never
          assumed to be free.
        </p>
      </CardFooter>
    </Card>
  )
}

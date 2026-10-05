import { useEffect, useState } from "react"
import type { RequestView, TimeWindow } from "../../../packages/contracts/index"
import { api, rememberRequest, requestToken } from "@/lib/api"
import {
  ErrorState,
  Loading,
  Notice,
  Submit,
  TextField,
  useAction,
  useResource,
} from "@/lib/ui"
import {
  Recovery,
  Verification,
  DetailsEditor,
  PrivateTravel,
  PreferenceException,
} from "./RequestExtras"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCw,
  Video,
} from "lucide-react"
import {
  Message,
  MessageContent,
  MessageHeader,
  MessageFooter,
} from "@/components/ui/message"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller"

const closed = ["booked", "declined", "withdrawn", "expired"]
const statusLabels: Record<string, string> = {
  gathering: "Gathering details",
  negotiating: "Finding a time",
  awaiting_approval: "Awaiting host approval",
  booking: "Booking pending",
  booked: "Booked",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
}
const nextActionLabels: Record<string, string> = {
  resolve_availability: "Clarify availability",
  provide_availability: "Add availability",
  verify_contact: "Verify your contact",
  review_proposal: "Review the proposed time",
  await_requester: "Waiting for requester agreement",
  await_host: "Waiting for host approval",
  approve: "Approve the proposed time",
  book: "Complete the booking",
  none: "No action needed",
}

function nextActionLabel(nextAction: string) {
  return (
    nextActionLabels[nextAction] ??
    nextAction
      .replaceAll("_", " ")
      .replace(/^./, (character) => character.toUpperCase())
  )
}
export function timeLabel(window: TimeWindow, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
  return `${formatter.format(new Date(window.start))} – ${formatter.format(new Date(window.end))}`
}
export function Inbox() {
  const requests = useResource<{ requests: RequestView[] }>("/host/requests")
  const [query, setQuery] = useState("")
  if (requests.loading) return <Loading />
  if (requests.error || !requests.data)
    return (
      <ErrorState
        error={requests.error || "Your inbox could not be loaded."}
        retry={requests.refresh}
      />
    )
  const allRequests = requests.data.requests
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredRequests = normalizedQuery
    ? allRequests.filter((request) =>
        [
          request.details.requesterName,
          request.details.requesterEmail,
          request.details.purpose,
          statusLabels[request.status],
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
      )
    : allRequests
  const awaitingApproval = allRequests.filter(
    (request) => request.status === "awaiting_approval"
  ).length
  const active = allRequests.filter(
    (request) => !closed.includes(request.status)
  ).length
  const booked = allRequests.filter(
    (request) => request.status === "booked"
  ).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Your meeting inbox
          </h1>
          <p className="mt-2 text-muted-foreground">
            The details you need. The final call is yours.
          </p>
        </div>
        <Button variant="outline" onClick={requests.refresh}>
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>
      {!!allRequests.length && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardDescription>Awaiting approval</CardDescription>
                <CalendarClock className="size-4 text-muted-foreground" />
              </div>
              <CardTitle className="text-3xl">{awaitingApproval}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Ready for your final decision.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardDescription>Active requests</CardDescription>
                <Clock3 className="size-4 text-muted-foreground" />
              </div>
              <CardTitle className="text-3xl">{active}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Still gathering, negotiating, or booking.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardDescription>Booked</CardDescription>
                <CheckCircle2 className="size-4 text-muted-foreground" />
              </div>
              <CardTitle className="text-3xl">{booked}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Confirmed meetings in this inbox.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
      {!allRequests.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>A little breathing room</EmptyTitle>
            <EmptyDescription>
              New meeting requests will appear here. Share your booking link
              when your setup is ready.
            </EmptyDescription>
          </EmptyHeader>
          <Button render={<a href="/host" />} nativeButton={false}>
            Review setup
          </Button>
        </Empty>
      )}
      {!!allRequests.length && (
        <Card>
          <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle role="heading" aria-level={2}>
                Requests
              </CardTitle>
              <CardDescription>
                Open a request to review the details and choose the next step.
              </CardDescription>
            </div>
            <Field className="w-full sm:max-w-xs">
              <FieldLabel htmlFor="request-search" className="sr-only">
                Search requests
              </FieldLabel>
              <Input
                id="request-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search requests"
              />
            </Field>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {filteredRequests.map((request) => (
              <Card key={request.id} size="sm">
                <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle role="heading" aria-level={3}>
                      {request.details.requesterName}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">
                      {request.details.purpose}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      request.status === "booked" ? "default" : "secondary"
                    }
                  >
                    {statusLabels[request.status]}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2 text-sm">
                    {request.proposal ? (
                      <CalendarCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : request.details.mode === "online" ? (
                      <Video className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span>
                      {request.proposal
                        ? timeLabel(request.proposal, request.proposal.timezone)
                        : `${request.details.durationMinutes} minutes · ${request.details.mode === "online" ? "Online" : "In person"}`}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    render={<a href={`/host/requests/${request.id}`} />}
                    nativeButton={false}
                  >
                    Review request
                  </Button>
                </CardContent>
              </Card>
            ))}
            {!filteredRequests.length && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No matching requests</EmptyTitle>
                  <EmptyDescription>
                    Try another name, email, purpose, or status.
                  </EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              </Empty>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
export function RequestPage({
  id,
  host = false,
}: {
  id: string
  host?: boolean
}) {
  const [token, setToken] = useState(() => {
    const fragment = new URLSearchParams(location.hash.slice(1))
    const received = fragment.get("token")
    if (received && !host) {
      rememberRequest(id, received)
      history.replaceState(null, "", `${location.pathname}${location.search}`)
      return received
    }
    return requestToken(id)
  })
  const [recoveryToken, setRecoveryToken] = useState(() =>
    new URLSearchParams(location.hash.slice(1)).get("recovery")
  )
  useEffect(() => {
    const handleFragment = () => {
      if (host) return
      const fragment = new URLSearchParams(location.hash.slice(1))
      setRecoveryToken(fragment.get("recovery"))
      const received = fragment.get("token")
      if (received) {
        rememberRequest(id, received)
        setToken(received)
        history.replaceState(null, "", `${location.pathname}${location.search}`)
      }
    }
    window.addEventListener("hashchange", handleFragment)
    return () => window.removeEventListener("hashchange", handleFragment)
  }, [host, id])
  const recovered = (value: { request: RequestView; token: string }) => {
    rememberRequest(id, value.token)
    setToken(value.token)
    setRecoveryToken(null)
    history.replaceState(null, "", `${location.pathname}${location.search}`)
  }
  if (!host && recoveryToken)
    return (
      <Recovery id={id} recoveryToken={recoveryToken} onRecovered={recovered} />
    )
  if (!host && !token)
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <Card className="mx-auto w-full max-w-lg">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Continue your request
            </CardTitle>
            <CardDescription>
              Open your protected continuation link, or paste its request
              credential below. Your email address alone cannot unlock a
              request.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const value = String(new FormData(e.currentTarget).get("token"))
                rememberRequest(id, value)
                setToken(value)
              }}
            >
              <FieldGroup>
                <TextField
                  label="Request credential"
                  name="token"
                  type="password"
                  required
                  autoComplete="off"
                />
                <Button type="submit">Open request</Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <Recovery id={id} onRecovered={recovered} />
      </div>
    )
  return (
    <RequestDetail
      key={`${id}-${host}-${token}`}
      id={id}
      host={host}
      token={host ? undefined : token}
      onRecovered={recovered}
    />
  )
}
function RequestDetail({
  id,
  host,
  token,
  onRecovered,
}: {
  id: string
  host: boolean
  token?: string
  onRecovered: (value: { request: RequestView; token: string }) => void
}) {
  const resource = useResource<RequestView>(
    `/requests/${encodeURIComponent(id)}`,
    token
  )
  const action = useAction()
  useEffect(() => {
    const timer = setInterval(resource.refresh, 12000)
    return () => clearInterval(timer)
  }, [resource.refresh])
  if (resource.loading) return <Loading />
  if (resource.error && !resource.data)
    return (
      <div className="flex flex-col gap-6">
        <ErrorState error={resource.error} retry={resource.refresh} />
        {!host && <Recovery id={id} onRecovered={onRecovered} />}
      </div>
    )
  if (!resource.data)
    return <Notice error>This request could not be loaded.</Notice>
  const request = resource.data
  const mutable =
    !closed.includes(request.status) && request.status !== "booking"
  const mutation = (
    operation: string,
    body: Record<string, unknown> = {},
    after?: () => void
  ) =>
    action.run(
      (key) =>
        api<RequestView>(`/requests/${id}/${operation}`, {
          token,
          idempotencyKey: key,
          body: { ...body, expectedRevision: request.revision },
        }),
      (value) => {
        resource.setData(value)
        after?.()
      },
      JSON.stringify([operation, body, request.revision])
    )
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          className="w-fit"
          render={<a href={host ? "/host/inbox" : "/"} />}
          nativeButton={false}
        >
          <ArrowLeft data-icon="inline-start" />
          {host ? "Back to inbox" : "Back to Find Me a Time"}
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={request.status === "booked" ? "default" : "secondary"}
              >
                {statusLabels[request.status]}
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {host
                ? `Meeting with ${request.details.requesterName}`
                : "Your meeting request"}
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {request.details.purpose}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline">Next step</Badge>
              <span className="text-sm font-medium">
                {nextActionLabel(request.nextAction)}
              </span>
            </div>
          </div>
          <Button variant="outline" onClick={resource.refresh}>
            <RefreshCw data-icon="inline-start" />
            Refresh status
          </Button>
        </div>
      </div>
      {action.error && (
        <Notice error>
          {action.error} Refresh the request before trying a changed proposal.
        </Notice>
      )}
      {resource.error && <Notice error>{resource.error}</Notice>}
      {request.nextAction === "resolve_availability" && (
        <Notice>
          {host
            ? "Availability needs clarification. Review private travel details, then check availability again."
            : "Availability needs clarification. The host may need to review travel details; you can also update your windows and check again."}
          {host && mutable && (
            <Button
              variant="outline"
              disabled={action.pending}
              onClick={() => mutation("evaluate")}
            >
              Check availability
            </Button>
          )}
        </Notice>
      )}
      {request.status === "booking" && (
        <Notice>
          Booking is pending. We’re checking the calendar outcome before
          confirming. Please keep this request to follow the result.
        </Notice>
      )}
      {request.status === "booked" && (
        <Notice>
          Your meeting is confirmed. To reschedule or cancel, manage the
          existing event in your calendar.
          {request.event?.url && (
            <a
              href={request.event.url}
              rel="noreferrer"
              target="_blank"
              className="underline"
            >
              {" "}
              Open calendar event
            </a>
          )}
        </Notice>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          {!host && mutable && (
            <Verification
              request={request}
              token={token}
              onChanged={resource.setData}
            />
          )}
          {request.proposal && (
            <ProposalReview
              key={`${request.revision}-${host}`}
              request={request}
              host={host}
              pending={action.pending}
              mutate={mutation}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Request overview
              </CardTitle>
              <CardDescription>
                The original meeting details from the requester.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">Requester</dt>
                  <dd className="font-medium">
                    {request.details.requesterName}
                  </dd>
                  <dd className="break-all text-muted-foreground">
                    {request.details.requesterEmail}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="font-medium">
                    {request.details.durationMinutes} minutes
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">Meeting format</dt>
                  <dd className="flex items-start gap-2 font-medium">
                    {request.details.mode === "online" ? (
                      <Video className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="break-words">
                      {request.details.mode === "online"
                        ? "Online"
                        : "In person"}
                      {request.details.location &&
                        ` · ${request.details.location}`}
                    </span>
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">Timezone</dt>
                  <dd className="font-medium">{request.details.timezone}</dd>
                </div>
              </dl>
            </CardContent>
            <CardFooter>
              <p className="text-sm text-muted-foreground">
                Proposed times are not reserved until booking is confirmed.
              </p>
            </CardFooter>
          </Card>
          {!host && mutable && (
            <Candidates
              key={`candidates-${request.revision}`}
              request={request}
              pending={action.pending}
              mutate={mutation}
            />
          )}
          {!host && mutable && (
            <DetailsEditor
              key={`details-${request.revision}`}
              request={request}
              pending={action.pending}
              mutate={mutation}
            />
          )}
          {host && mutable && (
            <HostRevision
              request={request}
              pending={action.pending}
              mutate={mutation}
            />
          )}
          {host && request.proposal && (
            <PreferenceException
              key={`exception-${request.revision}`}
              request={request}
              mutable={mutable}
              pending={action.pending}
              mutate={mutation}
            />
          )}
          {host && mutable && (
            <PrivateTravel
              key={`travel-${request.revision}`}
              request={request}
              pending={action.pending}
              mutate={mutation}
            />
          )}
          {host && (request.privateNotes || request.exceptions?.length) && (
            <Card>
              <CardHeader>
                <Badge variant="secondary">Only you can see this</Badge>
                <CardTitle role="heading" aria-level={2}>
                  Private review notes
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {request.privateNotes && (
                  <p className="text-sm whitespace-pre-wrap">
                    {request.privateNotes}
                  </p>
                )}
                {request.exceptions?.map((exception, i) => (
                  <Notice key={i}>{exception}</Notice>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Conversation
            request={request}
            host={host}
            mutable={mutable}
            pending={action.pending}
            mutate={mutation}
          />
          {host && (
            <Conversation
              privateChat
              request={request}
              host={host}
              mutable={mutable}
              pending={action.pending}
              mutate={mutation}
            />
          )}
          {!host && mutable && (
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Your availability
                </CardTitle>
                <CardDescription>
                  Use the windows you shared, or connect Google Calendar to
                  check your availability. You can disconnect at any time.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button
                  disabled={action.pending}
                  onClick={() =>
                    action.run(
                      (key) =>
                        api<{ url: string }>(`/requests/${id}/google/connect`, {
                          token,
                          body: { expectedRevision: request.revision },
                          idempotencyKey: key,
                        }),
                      (value) => location.assign(value.url),
                      "google-connect"
                    )
                  }
                >
                  Connect Google Calendar
                </Button>
                {request.calendarConnected && (
                  <Badge variant="secondary">
                    Calendar availability connected
                  </Badge>
                )}
                {request.calendarConnected && (
                  <Button
                    variant="outline"
                    disabled={action.pending}
                    onClick={() => mutation("calendar/disconnect")}
                  >
                    Disconnect calendar access
                  </Button>
                )}
                <p className="text-sm text-muted-foreground">
                  Denied or failed consent keeps this request open. You can
                  continue with manual availability.
                </p>
              </CardContent>
            </Card>
          )}
          {!host && (
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Keep your continuation link
                </CardTitle>
                <CardDescription>
                  This private link grants access only to this request. Store it
                  somewhere safe and share it only with your authorized agent.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() =>
                    action.run(
                      () =>
                        navigator.clipboard.writeText(
                          `${location.origin}/requests/${id}#token=${encodeURIComponent(token ?? "")}`
                        ),
                      () => {},
                      "copy"
                    )
                  }
                >
                  Copy protected link
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {mutable && (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={action.pending}
            onClick={() => mutation(host ? "decline" : "withdraw")}
          >
            {host ? "Decline request" : "Withdraw request"}
          </Button>
        </div>
      )}
      {host && request.deliveryStatus && (
        <p className="text-sm text-muted-foreground">
          Notification status: {request.deliveryStatus}. Confirmed booking
          status does not depend on notification delivery.
        </p>
      )}
    </div>
  )
}
function ProposalReview({
  request,
  host,
  pending,
  mutate,
}: {
  request: RequestView
  host: boolean
  pending: boolean
  mutate: (
    operation: string,
    body?: Record<string, unknown>,
    after?: () => void
  ) => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const proposal = request.proposal!
  const mutable =
    !closed.includes(request.status) && request.status !== "booking"
  const decisionLabel = closed.includes(request.status)
    ? statusLabels[request.status]
    : request.status === "booking"
      ? "Booking pending"
      : host
        ? request.requesterAgreed && !request.hostApproved
          ? "Ready for your approval"
          : request.hostApproved
            ? "Host approved"
            : "Waiting for requester"
        : !request.requesterAgreed
          ? "Your agreement is needed"
          : "Agreement sent"
  return (
    <Card className="bg-linear-to-t from-primary/5 to-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="outline">
            <CalendarCheck />
            Proposal {proposal.version}
          </Badge>
          <Badge variant="secondary">{decisionLabel}</Badge>
        </div>
        <CardTitle role="heading" aria-level={2}>
          {timeLabel(proposal, proposal.timezone)}
        </CardTitle>
        <CardDescription>
          {proposal.mode === "online" ? "Online" : "In person"}
          {proposal.location && ` · ${proposal.location}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          {proposal.requesterName} · {proposal.purpose}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={request.requesterAgreed ? "default" : "secondary"}>
            {request.requesterAgreed
              ? "Requester agreed"
              : "Requester agreement needed"}
          </Badge>
          <Badge variant={request.hostApproved ? "default" : "secondary"}>
            {request.hostApproved ? "Host approved" : "Host approval needed"}
          </Badge>
        </div>
        {mutable &&
          (host
            ? request.requesterAgreed && !request.hostApproved
            : !request.requesterAgreed) && (
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id="proposal-confirm"
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                <FieldLabel htmlFor="proposal-confirm">
                  {host
                    ? `I approve booking proposal ${proposal.version} with these exact details.`
                    : `I agree to proposal ${proposal.version} with these exact details.`}
                </FieldLabel>
              </Field>
              <Button
                disabled={
                  !confirmed || pending || (!host && !request.contactVerified)
                }
                onClick={() =>
                  mutate(host ? "approve" : "agree", {
                    proposalVersion: proposal.version,
                    ...(host ? { confirmed: true } : {}),
                  })
                }
              >
                {host ? "Approve this proposal" : "Agree and send to host"}
              </Button>
            </FieldGroup>
          )}
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">
          {host
            ? "Approval starts a final availability check. Booking is confirmed only after the calendar event is verified."
            : "Your agreement sends this proposal for host approval. A change needs your agreement again."}
        </p>
      </CardFooter>
    </Card>
  )
}
function Candidates({
  request,
  pending,
  mutate,
}: {
  request: RequestView
  pending: boolean
  mutate: (
    operation: string,
    body?: Record<string, unknown>,
    after?: () => void
  ) => void
}) {
  const [choice, setChoice] = useState("")
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Find your time
        </CardTitle>
        <CardDescription>
          We check calendar conflicts, focus time, and travel before offering an
          option.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {request.candidates.length ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="candidate">Feasible options</FieldLabel>
              <NativeSelect
                id="candidate"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                <NativeSelectOption value="">Choose a time</NativeSelectOption>
                {request.candidates.map((candidate, i) => (
                  <NativeSelectOption key={candidate.start} value={String(i)}>
                    {timeLabel(candidate, request.details.timezone)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button
              disabled={!choice || pending}
              onClick={() =>
                mutate("proposal", { ...request.candidates[Number(choice)] })
              }
            >
              Create proposal
            </Button>
          </FieldGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            {request.nextAction === "resolve_availability"
              ? "No options are proven yet. Travel or availability needs clarification with the host. Update your windows or check again after clarification."
              : "No options have been found yet. Check your availability or add a wider window below."}
          </p>
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => mutate("evaluate")}
        >
          Check availability
        </Button>
      </CardContent>
    </Card>
  )
}
function HostRevision({
  request,
  pending,
  mutate,
}: {
  request: RequestView
  pending: boolean
  mutate: (
    operation: string,
    body?: Record<string, unknown>,
    after?: () => void
  ) => void
}) {
  const [mode, setMode] = useState(
    request.proposal?.mode ?? request.details.mode
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Suggest a change
        </CardTitle>
        <CardDescription>
          A revision returns to the requester for agreement. Times below use
          your browser timezone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            const start = new Date(String(form.get("start")))
            const end = new Date(String(form.get("end")))
            if (end <= start) {
              const input =
                e.currentTarget.querySelector<HTMLInputElement>("[name=end]")
              input?.setCustomValidity("Choose an end after the start.")
              input?.reportValidity()
              return
            }
            mutate("revise", {
              start: start.toISOString(),
              end: end.toISOString(),
              mode,
              location: String(form.get("location")),
            })
          }}
        >
          <FieldGroup>
            <FieldGroup className="sm:flex-row">
              <TextField
                name="start"
                label="Starts"
                type="datetime-local"
                required
              />
              <TextField
                name="end"
                label="Ends"
                type="datetime-local"
                required
                onChange={(e) => e.target.setCustomValidity("")}
              />
            </FieldGroup>
            <Field>
              <FieldLabel id="revision-mode">Meeting mode</FieldLabel>
              <ToggleGroup
                aria-labelledby="revision-mode"
                value={[mode]}
                onValueChange={(values) => {
                  if (values[0]) setMode(values[0] as typeof mode)
                }}
                spacing={2}
              >
                <ToggleGroupItem value="online">Online</ToggleGroupItem>
                <ToggleGroupItem value="in_person">In person</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <TextField
              name="location"
              label="Location or meeting link"
              defaultValue={
                request.proposal?.location ?? request.details.location
              }
              required={mode === "in_person"}
            />
            <Submit pending={pending}>Send revised proposal</Submit>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
function Conversation({
  request,
  host,
  mutable,
  pending,
  mutate,
  privateChat = false,
}: {
  request: RequestView
  host: boolean
  privateChat?: boolean
  mutable: boolean
  pending: boolean
  mutate: (
    operation: string,
    body?: Record<string, unknown>,
    after?: () => void
  ) => void
}) {
  const [text, setText] = useState("")
  const messages = privateChat
    ? (request.privateMessages ?? [])
    : request.messages
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {privateChat
            ? "Private host conversation"
            : "Scheduling conversation"}
        </CardTitle>
        <CardDescription>
          {privateChat
            ? "Only you and the scheduling assistant can see this discussion."
            : host
              ? "Shared request conversation. Private review notes appear separately."
              : "Share missing details or ask for alternatives."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {messages.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Ready when you are</EmptyTitle>
              <EmptyDescription>
                Your scheduling conversation will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="h-80">
            <MessageScrollerProvider autoScroll>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent>
                    {messages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                      >
                        <Message
                          align={
                            (
                              privateChat
                                ? message.role === "host"
                                : message.role === "requester"
                            )
                              ? "end"
                              : "start"
                          }
                        >
                          <MessageContent>
                            <MessageHeader>
                              {message.role === "requester"
                                ? request.details.requesterName
                                : message.role === "assistant"
                                  ? "Scheduling assistant"
                                  : "Host"}
                            </MessageHeader>
                            <Bubble
                              variant={
                                (
                                  privateChat
                                    ? message.role === "host"
                                    : message.role === "requester"
                                )
                                  ? "default"
                                  : "muted"
                              }
                              align={
                                (
                                  privateChat
                                    ? message.role === "host"
                                    : message.role === "requester"
                                )
                                  ? "end"
                                  : "start"
                              }
                            >
                              <BubbleContent className="break-words whitespace-pre-wrap">
                                {message.text}
                              </BubbleContent>
                            </Bubble>
                            <MessageFooter>
                              {new Date(message.createdAt).toLocaleString()}
                            </MessageFooter>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ))}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
        )}
        {(!host || privateChat) && mutable && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!text.trim()) return
              mutate(
                privateChat ? "private-messages" : "messages",
                { text: text.trim() },
                () => setText("")
              )
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel
                  htmlFor={privateChat ? "private-message" : "message"}
                >
                  {privateChat ? "Private message" : "Your message"}
                </FieldLabel>
                <Textarea
                  id={privateChat ? "private-message" : "message"}
                  value={text}
                  maxLength={4000}
                  required
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    privateChat
                      ? "What should I consider for this request?"
                      : "Could we look at next week instead?"
                  }
                />
              </Field>
              <Submit pending={pending}>Send message</Submit>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

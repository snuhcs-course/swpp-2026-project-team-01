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
import {
  Conversation as AIConversation,
  ConversationContent as AIConversationContent,
  ConversationEmptyState as AIConversationEmptyState,
  ConversationScrollButton as AIConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message as AIMessage,
  MessageContent as AIMessageContent,
  MessageResponse as AIMessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputProvider,
  usePromptInputController,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"

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
    <div className="flex min-w-0 flex-col gap-6">
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
      <div className="flex min-w-0 flex-col gap-6">
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
    after?: (value: RequestView) => void
  ) => {
    let completed = false
    return action
      .run(
        (key) =>
          api<RequestView>(`/requests/${id}/${operation}`, {
            token,
            idempotencyKey: key,
            body: { ...body, expectedRevision: request.revision },
          }),
        (value) => {
          completed = true
          resource.setData(value)
          after?.(value)
        },
        JSON.stringify([operation, body, request.revision])
      )
      .then(() => completed)
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
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
        <div className="flex min-w-0 flex-col gap-6">
          {!host && mutable && (
            <Verification
              request={request}
              token={token}
              onChanged={resource.setData}
            />
          )}
          {host && request.proposal && (
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
                The current meeting details from the requester.
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
        <div className="flex min-w-0 flex-col gap-6">
          <RequestConversation
            request={request}
            host={host}
            mutable={mutable}
            pending={action.pending}
            mutate={mutation}
          />
          {host && (
            <RequestConversation
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
    after?: (value: RequestView) => void
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
    after?: (value: RequestView) => void
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
interface RequestConversationReview {
  reviewedRevision: number
  clarification: string
  patch: Partial<
    Pick<RequestView["details"], "purpose" | "mode" | "location" | "windows">
  >
}
type RequestMutation = (
  operation: string,
  body?: Record<string, unknown>,
  after?: (value: RequestView) => void
) => Promise<boolean> | void
function RequestConversation({
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
  mutate: RequestMutation
}) {
  if (privateChat)
    return (
      <PrivateHostConversation
        request={request}
        mutable={mutable}
        pending={pending}
        mutate={mutate}
      />
    )
  return (
    <PromptInputProvider>
      <SharedRequestConversation
        request={request}
        host={host}
        mutable={mutable}
        pending={pending}
        mutate={mutate}
      />
    </PromptInputProvider>
  )
}
function SharedRequestConversation({
  request,
  host,
  mutable,
  pending,
  mutate,
}: {
  request: RequestView
  host: boolean
  mutable: boolean
  pending: boolean
  mutate: RequestMutation
}) {
  const { value: text, setInput: setText } =
    usePromptInputController().textInput
  const [selection, setSelection] = useState<{
    revision: number
    value: string
  } | null>(null)
  const choice = selection?.revision === request.revision ? selection.value : ""
  const [agreementVersion, setAgreementVersion] = useState<number | null>(null)
  const [review, setReview] = useState<RequestConversationReview | null>(
    () =>
      (
        request as RequestView & {
          conversationReview?: RequestConversationReview
        }
      ).conversationReview ?? null
  )
  const reviewIsCurrent = review?.reviewedRevision === request.revision
  const proposal = request.proposal
  const quickPrompts = [
    "I need a different day",
    "Change this to an online meeting",
    "Show me what happens next",
  ]
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Scheduling conversation
        </CardTitle>
        <CardDescription>
          {host
            ? "Shared request conversation. Private review notes appear separately."
            : "Describe changes in your own words, then review every action before it changes your request."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <div className="h-96 overflow-hidden rounded-xl border bg-muted/20">
          <AIConversation>
            {request.messages.length === 0 ? (
              <AIConversationEmptyState
                title="Ready when you are"
                description="Tell the scheduling assistant what you want to change or ask what happens next."
              />
            ) : (
              <AIConversationContent>
                {request.messages.map((message) => {
                  const from =
                    message.role === "requester" ? "user" : "assistant"
                  return (
                    <AIMessage from={from} key={message.id}>
                      <AIMessageContent>
                        <p className="text-xs font-medium text-muted-foreground">
                          {message.role === "requester"
                            ? request.details.requesterName
                            : message.role === "assistant"
                              ? "Scheduling assistant"
                              : "Host"}
                        </p>
                        <AIMessageResponse>{message.text}</AIMessageResponse>
                        <p className="text-xs text-muted-foreground">
                          {new Date(message.createdAt).toLocaleString()}
                        </p>
                      </AIMessageContent>
                    </AIMessage>
                  )
                })}
              </AIConversationContent>
            )}
            <AIConversationScrollButton />
          </AIConversation>
        </div>
        {!host && mutable && review && (
          <Card size="sm" className="border-primary/30 bg-primary/5">
            <CardHeader>
              <Badge variant="outline" className="w-fit">
                Review before applying
              </Badge>
              <CardTitle role="heading" aria-level={3}>
                Suggested request changes
              </CardTitle>
              <CardDescription>{review.clarification}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {review.patch.purpose && (
                  <div>
                    <dt className="text-muted-foreground">Purpose</dt>
                    <dd className="font-medium">{review.patch.purpose}</dd>
                  </div>
                )}
                {review.patch.mode && (
                  <div>
                    <dt className="text-muted-foreground">Meeting format</dt>
                    <dd className="font-medium">
                      {review.patch.mode === "online" ? "Online" : "In person"}
                    </dd>
                  </div>
                )}
                {review.patch.location !== undefined && (
                  <div>
                    <dt className="text-muted-foreground">Location</dt>
                    <dd className="font-medium">
                      {review.patch.location || "No location"}
                    </dd>
                  </div>
                )}
                {review.patch.windows?.map((window, index) => (
                  <div key={`${window.start}-${window.end}`}>
                    <dt className="text-muted-foreground">
                      Availability {index + 1}
                    </dt>
                    <dd className="font-medium">
                      {timeLabel(window, request.details.timezone)}
                    </dd>
                  </div>
                ))}
              </dl>
              {!reviewIsCurrent && (
                <Notice error>
                  This review is out of date because the request changed. Send
                  the details again to create a current review.
                </Notice>
              )}
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button
                disabled={pending || !reviewIsCurrent}
                onClick={() =>
                  mutate(
                    "conversation-review",
                    {
                      reviewedRevision: review.reviewedRevision,
                      confirmed: true,
                      patch: review.patch,
                    },
                    () => setReview(null)
                  )
                }
              >
                Apply these changes
              </Button>
              <Button variant="ghost" onClick={() => setReview(null)}>
                Keep current details
              </Button>
            </CardFooter>
          </Card>
        )}
        {!host && mutable && !proposal && (
          <Card size="sm">
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>
                Find a time
              </CardTitle>
              <CardDescription>
                Availability is checked against the current reviewed request.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {request.candidates.length > 0 && (
                <Field>
                  <FieldLabel htmlFor="conversation-candidate">
                    Feasible options
                  </FieldLabel>
                  <NativeSelect
                    id="conversation-candidate"
                    value={choice}
                    onChange={(event) =>
                      setSelection({
                        revision: request.revision,
                        value: event.target.value,
                      })
                    }
                  >
                    <NativeSelectOption value="">
                      Choose a time
                    </NativeSelectOption>
                    {request.candidates.map((candidate, index) => (
                      <NativeSelectOption
                        key={candidate.start}
                        value={String(index)}
                      >
                        {timeLabel(candidate, request.details.timezone)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              {request.candidates.length > 0 && (
                <Button
                  disabled={!choice || pending}
                  onClick={() =>
                    mutate("proposal", {
                      ...request.candidates[Number(choice)],
                    })
                  }
                >
                  Review this time
                </Button>
              )}
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => mutate("evaluate")}
              >
                Check availability
              </Button>
            </CardFooter>
          </Card>
        )}
        {!host && mutable && proposal && !request.requesterAgreed && (
          <Card size="sm" className="border-primary/30 bg-primary/5">
            <CardHeader>
              <Badge variant="outline" className="w-fit">
                Proposal {proposal.version}
              </Badge>
              <CardTitle role="heading" aria-level={3}>
                {timeLabel(proposal, proposal.timezone)}
              </CardTitle>
              <CardDescription>
                {proposal.mode === "online" ? "Online" : "In person"}
                {proposal.location && ` · ${proposal.location}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm">
                {proposal.requesterName} · {proposal.purpose}
              </p>
              <Field orientation="horizontal">
                <Checkbox
                  id={`conversation-agree-${proposal.version}`}
                  checked={agreementVersion === proposal.version}
                  onCheckedChange={(value) =>
                    setAgreementVersion(
                      value === true ? proposal.version : null
                    )
                  }
                />
                <FieldLabel htmlFor={`conversation-agree-${proposal.version}`}>
                  I agree to proposal {proposal.version} with this exact time,
                  format, location, and purpose.
                </FieldLabel>
              </Field>
            </CardContent>
            <CardFooter>
              <Button
                disabled={
                  pending ||
                  agreementVersion !== proposal.version ||
                  !request.contactVerified
                }
                onClick={() =>
                  mutate("agree", { proposalVersion: proposal.version })
                }
              >
                Agree and send to host
              </Button>
            </CardFooter>
          </Card>
        )}
        {!host && request.requesterAgreed && proposal && (
          <Notice>
            You agreed to proposal {proposal.version}. The host must still
            approve it before booking begins.
          </Notice>
        )}
        {!host && mutable && (
          <>
            <Suggestions className="min-w-0 max-w-full">
              {quickPrompts.map((prompt) => (
                <Suggestion
                  key={prompt}
                  suggestion={prompt}
                  onClick={setText}
                  disabled={pending}
                />
              ))}
            </Suggestions>
            <PromptInput
              aria-label="Scheduling message"
              onSubmit={async ({ text: submitted }) => {
                const message = submitted.trim()
                if (!message) return
                const completed = await mutate(
                  "messages",
                  { text: message },
                  (value) => {
                    const next = (
                      value as RequestView & {
                        conversationReview?: RequestConversationReview
                      }
                    ).conversationReview
                    setReview(next ?? null)
                  }
                )
                if (completed === false)
                  throw new Error(
                    "Your message could not be saved. Please retry."
                  )
              }}
            >
              <PromptInputBody>
                <PromptInputTextarea
                  aria-label="Your scheduling message"
                  maxLength={4000}
                  placeholder="Tell me what you want to change or ask what happens next"
                  disabled={pending}
                />
              </PromptInputBody>
              <PromptInputFooter>
                <span className="text-xs text-muted-foreground">
                  Review is required before details or decisions change.
                </span>
                <PromptInputSubmit
                  disabled={pending || !text.trim()}
                  status={pending ? "submitted" : undefined}
                />
              </PromptInputFooter>
            </PromptInput>
          </>
        )}
      </CardContent>
    </Card>
  )
}
function PrivateHostConversation({
  request,
  mutable,
  pending,
  mutate,
}: {
  request: RequestView
  mutable: boolean
  pending: boolean
  mutate: RequestMutation
}) {
  const [text, setText] = useState("")
  const messages = request.privateMessages ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Private host conversation
        </CardTitle>
        <CardDescription>
          Only you and the scheduling assistant can see this discussion.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {messages.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Ready when you are</EmptyTitle>
              <EmptyDescription>
                Private review notes will appear here.
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
                          align={message.role === "host" ? "end" : "start"}
                        >
                          <MessageContent>
                            <MessageHeader>
                              {message.role === "assistant"
                                ? "Scheduling assistant"
                                : "Host"}
                            </MessageHeader>
                            <Bubble
                              variant={
                                message.role === "host" ? "default" : "muted"
                              }
                              align={message.role === "host" ? "end" : "start"}
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
        {mutable && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!text.trim()) return
              mutate("private-messages", { text: text.trim() }, () =>
                setText("")
              )
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="private-message">
                  Private message
                </FieldLabel>
                <Textarea
                  id="private-message"
                  value={text}
                  maxLength={4000}
                  required
                  onChange={(event) => setText(event.target.value)}
                  placeholder="What should I consider for this request?"
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

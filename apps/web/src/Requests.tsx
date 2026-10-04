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
  if (requests.loading) return <Loading />
  if (requests.error || !requests.data)
    return (
      <ErrorState
        error={requests.error || "Your inbox could not be loaded."}
        retry={requests.refresh}
      />
    )
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Your meeting inbox
          </h1>
          <p className="mt-2 text-muted-foreground">
            The details you need. The final call is yours.
          </p>
        </div>
        <Button variant="outline" onClick={requests.refresh}>
          Refresh
        </Button>
      </div>
      {!requests.data.requests.length && (
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
      <div className="grid gap-4 md:grid-cols-2">
        {requests.data.requests.map((request) => (
          <Card key={request.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle role="heading" aria-level={2}>
                  {request.details.requesterName}
                </CardTitle>
                <Badge
                  variant={
                    request.status === "booked" ? "default" : "secondary"
                  }
                >
                  {statusLabels[request.status]}
                </Badge>
              </div>
              <CardDescription>{request.details.purpose}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                {request.proposal
                  ? timeLabel(request.proposal, request.proposal.timezone)
                  : `${request.details.durationMinutes} minutes · ${request.details.mode === "online" ? "Online" : "In person"}`}
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                render={<a href={`/host/requests/${request.id}`} />}
                nativeButton={false}
              >
                Review request
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge
            variant={request.status === "booked" ? "default" : "secondary"}
          >
            {statusLabels[request.status]}
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {host
              ? `Meeting with ${request.details.requesterName}`
              : "Your meeting request"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {request.nextAction === "resolve_availability"
              ? "Clarify availability"
              : request.nextAction}
          </p>
        </div>
        <Button variant="outline" onClick={resource.refresh}>
          Refresh status
        </Button>
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
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Meeting details
              </CardTitle>
              <CardDescription>{request.details.purpose}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Requester</dt>
                <dd>
                  {request.details.requesterName}
                  <br />
                  {request.details.requesterEmail}
                </dd>
                <dt className="text-muted-foreground">Length</dt>
                <dd>{request.details.durationMinutes} minutes</dd>
                <dt className="text-muted-foreground">Where</dt>
                <dd className="break-words">
                  {request.details.mode === "online" ? "Online" : "In person"}
                  {request.details.location && ` · ${request.details.location}`}
                </dd>
                <dt className="text-muted-foreground">Timezone</dt>
                <dd>{request.details.timezone}</dd>
              </dl>
            </CardContent>
            <CardFooter>
              <p className="text-sm text-muted-foreground">
                Proposed times are not reserved until booking is confirmed.
              </p>
            </CardFooter>
          </Card>
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
  return (
    <Card>
      <CardHeader>
        <Badge variant="outline">Proposal {proposal.version}</Badge>
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

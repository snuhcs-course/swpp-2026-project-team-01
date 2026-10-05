import { useEffect, useRef, useState } from "react"
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
  MapPin,
  RefreshCw,
  Settings2,
  Video,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact"

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

  return (
    <Card className="mx-auto w-full max-w-4xl min-w-0 py-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4">
        <div className="flex flex-col gap-1">
          <CardTitle role="heading" aria-level={1}>
            Meeting inbox
          </CardTitle>
          <CardDescription>Your scheduling conversations</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh inbox"
          onClick={requests.refresh}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </CardHeader>
      <AIConversation
        className="h-[min(55svh,32rem)] min-h-72 flex-none md:h-[min(68svh,42rem)]"
        aria-label="Meeting inbox conversation"
      >
        <AIConversationContent className="gap-5 p-5 md:p-6">
          <AIMessage from="assistant">
            <AIMessageContent>
              {allRequests.length === 0
                ? "No meeting requests yet. Share your booking link when you’re ready."
                : awaitingApproval > 0
                  ? `${awaitingApproval} ${awaitingApproval === 1 ? "request needs" : "requests need"} your approval. Choose a conversation to review the current proposal.`
                  : "Choose a conversation to review the details or continue scheduling."}
            </AIMessageContent>
          </AIMessage>
          {filteredRequests.map((request) => (
            <Artifact key={request.id}>
              <ArtifactHeader>
                <div className="flex min-w-0 flex-col gap-1">
                  <ArtifactTitle>{request.details.requesterName}</ArtifactTitle>
                  <ArtifactDescription className="line-clamp-2">
                    {request.details.purpose}
                  </ArtifactDescription>
                </div>
                <Badge
                  variant={
                    request.status === "booked" ? "default" : "secondary"
                  }
                >
                  {statusLabels[request.status]}
                </Badge>
              </ArtifactHeader>
              <ArtifactContent className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {request.proposal
                    ? timeLabel(request.proposal, request.proposal.timezone)
                    : `${request.details.durationMinutes} minutes · ${request.details.mode === "online" ? "Online" : "In person"}`}
                </p>
                <Button
                  variant="outline"
                  render={<a href={`/host/requests/${request.id}`} />}
                  nativeButton={false}
                >
                  Open conversation
                </Button>
              </ArtifactContent>
            </Artifact>
          ))}
          {!!allRequests.length && !filteredRequests.length && (
            <AIMessage from="assistant">
              <AIMessageContent>
                No conversations match that search.
              </AIMessageContent>
            </AIMessage>
          )}
        </AIConversationContent>
        <AIConversationScrollButton />
      </AIConversation>
      <CardFooter className="border-t py-4">
        <Field>
          <FieldLabel htmlFor="request-search" className="sr-only">
            Search conversations
          </FieldLabel>
          <Input
            id="request-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
          />
        </Field>
      </CardFooter>
    </Card>
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
  const [recoveryError, setRecoveryError] = useState("")
  const recoveryAttempt = useRef<{ token: string; key: string } | null>(null)
  useEffect(() => {
    if (host || token || !recoveryToken) return
    if (recoveryAttempt.current?.token === recoveryToken) return
    const attempt = {
      token: recoveryToken,
      key: crypto.randomUUID(),
    }
    recoveryAttempt.current = attempt
    history.replaceState(null, "", `${location.pathname}${location.search}`)
    api<{ request: RequestView; token: string }>(
      `/requests/${id}/recovery/redeem`,
      {
        body: { token: recoveryToken },
        idempotencyKey: attempt.key,
      }
    )
      .then((value) => {
        rememberRequest(id, value.token)
        setToken(value.token)
      })
      .catch((error) => {
        setRecoveryError(
          error instanceof Error ? error.message : "Recovery failed."
        )
      })
  }, [host, id, recoveryToken, token])
  useEffect(() => {
    const handleFragment = () => {
      if (host) return
      const fragment = new URLSearchParams(location.hash.slice(1))
      const received = fragment.get("token")
      if (received) {
        rememberRequest(id, received)
        setToken(received)
        setRecoveryToken(null)
        history.replaceState(null, "", `${location.pathname}${location.search}`)
        return
      }
      const recovery = fragment.get("recovery")
      if (!token && recovery) setRecoveryToken(recovery)
    }
    window.addEventListener("hashchange", handleFragment)
    return () => window.removeEventListener("hashchange", handleFragment)
  }, [host, id, token])
  if (!host && !token)
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <Notice>
          {recoveryToken && !recoveryError
            ? "Restoring your private request…"
            : "This request is private. Open its protected continuation link to continue."}
        </Notice>
        {recoveryError && <Notice error>{recoveryError}</Notice>}
      </div>
    )
  return (
    <RequestDetail
      key={`${id}-${host}-${token}`}
      id={id}
      host={host}
      token={host ? undefined : token}
    />
  )
}
function RequestDetail({
  id,
  host,
  token,
}: {
  id: string
  host: boolean
  token?: string
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [conversationView, setConversationView] = useState<
    "shared" | "private"
  >("shared")
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
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="sr-only">
          {host
            ? `Meeting with ${request.details.requesterName}`
            : "Your meeting request"}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          render={<a href={host ? "/host/inbox" : "/"} />}
          nativeButton={false}
          aria-label={host ? "Back to inbox" : "Back to Find Me a Time"}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        {host && (
          <ToggleGroup
            value={[conversationView]}
            onValueChange={(value) =>
              setConversationView(value[0] === "private" ? "private" : "shared")
            }
            aria-label="Conversation visibility"
          >
            <ToggleGroupItem value="shared">Shared</ToggleGroupItem>
            <ToggleGroupItem value="private">Private</ToggleGroupItem>
          </ToggleGroup>
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh status"
            onClick={resource.refresh}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Request settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 aria-hidden="true" />
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
      <div className="flex w-full flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-6">
          {conversationView === "shared" || !host ? (
            <RequestConversation
              request={request}
              host={host}
              mutable={mutable}
              pending={action.pending}
              mutate={mutation}
            />
          ) : (
            <RequestConversation
              privateChat
              request={request}
              host={host}
              mutable={mutable}
              pending={action.pending}
              mutate={mutation}
            />
          )}
        </div>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="flex max-h-[90svh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="p-6 pb-4">
              <DialogTitle>Request settings</DialogTitle>
              <DialogDescription>
                Review exact details, calendar access, private constraints, and
                request actions.
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[70svh] min-w-0 flex-col gap-6 overflow-y-auto px-6 pb-6">
              {!host && mutable && (
                <Verification
                  request={request}
                  token={token}
                  onChanged={resource.setData}
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
                      <dd className="font-medium">
                        {request.details.timezone}
                      </dd>
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
                            api<{ url: string }>(
                              `/requests/${id}/google/connect`,
                              {
                                token,
                                body: { expectedRevision: request.revision },
                                idempotencyKey: key,
                              }
                            ),
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
            </div>
          </DialogContent>
        </Dialog>
      </div>
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
        <AIConversation
          className="h-[min(55svh,32rem)] min-h-72 flex-none rounded-xl border bg-muted/20 md:h-[min(68svh,42rem)]"
          aria-label="Scheduling conversation transcript"
        >
          <AIConversationContent className="gap-5 p-5 md:p-6">
            <AIMessage from="assistant">
              <AIMessageContent>
                {request.messages.length === 0
                  ? "Tell me what you want to change, or ask what happens next."
                  : "Here is the current request and its next step."}
              </AIMessageContent>
            </AIMessage>
            <Artifact>
              <ArtifactHeader>
                <div className="flex min-w-0 flex-col gap-1">
                  <ArtifactTitle>
                    {host
                      ? `Meeting with ${request.details.requesterName}`
                      : "Your meeting request"}
                  </ArtifactTitle>
                  <ArtifactDescription className="line-clamp-2">
                    {request.details.purpose}
                  </ArtifactDescription>
                </div>
                <Badge
                  variant={
                    request.status === "booked" ? "default" : "secondary"
                  }
                >
                  {statusLabels[request.status]}
                </Badge>
              </ArtifactHeader>
              <ArtifactContent className="text-sm">
                <span className="text-muted-foreground">Next step · </span>
                <span className="font-medium">
                  {nextActionLabel(request.nextAction)}
                </span>
              </ArtifactContent>
            </Artifact>
            {request.messages.map((message) => {
              const from = message.role === "requester" ? "user" : "assistant"
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
            {host && proposal && (
              <ProposalReview
                key={`${request.revision}-${host}`}
                request={request}
                host={host}
                pending={pending}
                mutate={mutate}
              />
            )}
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
                        <dt className="text-muted-foreground">
                          Meeting format
                        </dt>
                        <dd className="font-medium">
                          {review.patch.mode === "online"
                            ? "Online"
                            : "In person"}
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
                      This review is out of date because the request changed.
                      Send the details again to create a current review.
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
                    Availability is checked against the current reviewed
                    request.
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
                    <FieldLabel
                      htmlFor={`conversation-agree-${proposal.version}`}
                    >
                      I agree to proposal {proposal.version} with this exact
                      time, format, location, and purpose.
                    </FieldLabel>
                  </Field>
                </CardContent>
                <CardFooter className="flex-col items-start gap-2">
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
                  {!request.contactVerified && (
                    <p className="text-xs text-muted-foreground">
                      Verify your email in Request settings before sending your
                      agreement.
                    </p>
                  )}
                </CardFooter>
              </Card>
            )}
            {!host && request.requesterAgreed && proposal && (
              <Notice>
                You agreed to proposal {proposal.version}. The host must still
                approve it before booking begins.
              </Notice>
            )}
          </AIConversationContent>
          <AIConversationScrollButton />
        </AIConversation>
        {!host && mutable && (
          <>
            <Suggestions className="max-w-full min-w-0">
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

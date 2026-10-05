import { useEffect, useRef, useState, type ReactNode } from "react"
import type {
  SetupConversationState,
  SetupReview,
  SetupState,
} from "../../../packages/contracts/index"
import { api } from "@/lib/api"
import { ErrorState, Loading, Notice, useResource, useAction } from "@/lib/ui"
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
import { Spinner } from "@/components/ui/spinner"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { CheckCircle2, MessageCircle, Settings2 } from "lucide-react"
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type LinkState = {
  contactUrl?: string | null
  available: boolean
  link: { id: string; provider: "imessage"; linkedAt: string } | null
  challenge: {
    id: string
    expiresAt: string
    claimed: boolean
    senderLabel?: string
  } | null
}
type LinkStart = {
  contactUrl?: string | null
  challengeId: string
  provider: string
  expiresAt: string
  challengeText: string
  browserProof: string
}

export function captureIMessageContinuation() {
  const params = new URLSearchParams(location.hash.slice(1))
  const continuationId = params.get("imessage")
  const continuationSecret = params.get("proof")
  if (!continuationId || !continuationSecret) return
  if (
    !/^[a-f0-9-]{36}$/i.test(continuationId) ||
    continuationSecret.length > 256
  )
    return
  sessionStorage.setItem(
    "fmat-imessage-continuation",
    JSON.stringify({ continuationId, continuationSecret })
  )
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}`
  )
}

export function SetupConversation({
  initial,
  onSaved,
  protectedActions,
  statusArtifact,
  recovery,
}: {
  initial: SetupState
  onSaved: (setup: SetupState) => void
  protectedActions: ReactNode
  statusArtifact?: ReactNode
  recovery: ReactNode
}) {
  const resource = useResource<SetupConversationState>(
    initial.admitted ? "/host/setup/conversation" : null
  )
  const [showEditor, setShowEditor] = useState(false)
  const refreshConversation = resource.refresh
  const state = initial.admitted ? resource.data : null
  useEffect(() => {
    if (state) onSaved(state.setup)
  }, [state, onSaved])
  useEffect(() => {
    if (initial.admitted) refreshConversation()
  }, [initial.admitted, initial.nextAction, initial.profile?.ready, refreshConversation])
  useEffect(() => {
    if (!initial.admitted) return
    const refresh = () => {
      if (document.visibilityState === "visible") refreshConversation()
    }
    const timer = window.setInterval(refresh, 15_000)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [initial.admitted, refreshConversation])
  return (
    <div className="flex flex-col gap-6">
      <Card className="min-w-0 py-0">
        <CardHeader className="border-b py-5">
          <div className="flex items-center justify-between gap-3">
            <CardTitle role="heading" aria-level={2}>
              Let’s set up your calendar
            </CardTitle>
            <Badge variant="secondary">Private conversation</Badge>
          </div>
          <CardDescription>
            Tell us how you like to meet. Review each change before it becomes a
            scheduling rule.
          </CardDescription>
        </CardHeader>
        {!initial.admitted ? (
          <CardContent className="flex flex-col gap-5 py-6">
            <Message from="assistant">
              <MessageContent>
                Welcome. Start by accepting the invitation sent to your verified
                email. Then we can set up your meeting preferences together.
              </MessageContent>
            </Message>
            {statusArtifact}
            {protectedActions}
          </CardContent>
        ) : resource.loading ? (
          <CardContent className="py-6">
            <Loading />
          </CardContent>
        ) : resource.error || !state ? (
          <CardContent className="py-6">
            <ErrorState
              error={
                resource.error || "Your setup conversation could not be loaded."
              }
              retry={resource.refresh}
            />
          </CardContent>
        ) : (
          <PromptInputProvider>
            <SetupDialogue
              state={state}
              onChange={resource.setData}
              refresh={resource.refresh}
              protectedActions={showEditor ? null : protectedActions}
              statusArtifact={statusArtifact}
            />
          </PromptInputProvider>
        )}
        <CardFooter className="flex flex-wrap justify-between gap-3 border-t py-4">
          <p className="text-xs text-muted-foreground">
            Every meeting still needs your explicit approval.
          </p>
          {initial.admitted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEditor(true)}
            >
              <Settings2 data-icon="inline-start" />
              Setup settings
            </Button>
          )}
        </CardFooter>
      </Card>
      {initial.admitted && (
        <Dialog open={showEditor} onOpenChange={setShowEditor}>
          <DialogContent className="flex max-h-[90svh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="p-6 pb-4">
              <DialogTitle>Setup settings</DialogTitle>
              <DialogDescription>
                Edit exact values, manage calendar access, or connect another
                private channel.
              </DialogDescription>
            </DialogHeader>
            <div
              id="setup-structured-editor"
              className="flex max-h-[70svh] flex-col gap-5 overflow-y-auto px-6 pb-6"
            >
              <Notice>
                These controls are available when you need exact values. Your
                conversation remains the primary setup workspace.
              </Notice>
              {recovery}
              <IMessageSetup />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function nextStep(action: string) {
  const labels: Record<string, string> = {
    redeem_invitation: "Accept your invitation to activate host access.",
    save_rules:
      "Describe your name, booking link, timezone, and meeting preferences.",
    review_rules:
      "Review your proposed settings and confirm the current summary.",
    confirm_draft:
      "Review your proposed settings and confirm the current summary.",
    connect_calendar: "Connect Google Calendar to protect your busy time.",
    select_calendars:
      "Choose conflict calendars and a writable booking destination.",
    share_link: "Your booking link is ready to share.",
  }
  return (
    labels[action] ??
    "Tell us how you like to meet. We’ll guide you through setup."
  )
}

function SetupDialogue({
  state,
  onChange,
  refresh,
  protectedActions,
  statusArtifact,
}: {
  state: SetupConversationState
  onChange: (state: SetupConversationState) => void
  refresh: () => void
  protectedActions: ReactNode
  statusArtifact?: ReactNode
}) {
  const controller = usePromptInputController()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const lock = useRef(false)
  const keys = useRef(new Map<string, string>())
  const turnIds = useRef(new Map<string, string>())
  function turnId(text: string, revision: number) {
    const identity = JSON.stringify([text, revision])
    const id = turnIds.current.get(identity) ?? crypto.randomUUID()
    turnIds.current.set(identity, id)
    return id
  }
  async function mutate(path: string, body: unknown) {
    if (lock.current) throw new Error("Please wait for the current reply.")
    lock.current = true
    setPending(true)
    setError("")
    const identity = JSON.stringify([path, body])
    const key = keys.current.get(identity) ?? crypto.randomUUID()
    keys.current.set(identity, key)
    try {
      const updated = await api<SetupConversationState>(path, {
        body,
        idempotencyKey: key,
      })
      keys.current.delete(identity)
      onChange(updated)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The conversation could not be saved. Your message is still here."
      )
      throw cause
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return (
    <>
      <Conversation
        className="h-[min(54svh,34rem)] min-h-64 flex-none"
        aria-label="Host setup conversation"
      >
        <ConversationContent className="gap-5 p-5 md:p-6">
          {state.turns.length === 0 && (
            <Message from="assistant">
              <MessageContent>
                {state.setup.profile && state.setup.rules
                  ? "Your saved settings are ready. Tell me anything you’d like to change, and I’ll prepare a summary for your review."
                  : "Tell me your name, preferred booking link, timezone, and when you’d like to meet. I’ll draft your settings for review."}
              </MessageContent>
            </Message>
          )}
          {state.turns.map((message) => (
            <Message
              key={message.id}
              from={message.role === "host" ? "user" : "assistant"}
            >
              <span className="text-xs text-muted-foreground">
                {message.role === "host" ? "You" : "Find Me a Time"}
                {message.channel === "imessage" ? " · iMessage" : ""}
              </span>
              <MessageContent className="break-words whitespace-pre-wrap">
                {message.text}
              </MessageContent>
            </Message>
          ))}
          {state.review?.status === "pending" && state.draft && (
            <DraftReview
              review={state.review}
              pending={pending}
              onConfirm={() =>
                mutate("/host/setup/conversation/confirm", {
                  reviewRevision: state.review!.revision,
                  expectedRevision: state.revision,
                  expectedDraftRevision: state.review!.draftRevision,
                  expectedRulesVersion: state.draft!.baseRulesVersion,
                }).catch(() => undefined)
              }
            />
          )}
          {protectedActions}
          {statusArtifact}
          <Artifact>
            <ArtifactHeader>
              <div className="flex flex-col gap-1">
                <ArtifactTitle>Your next step</ArtifactTitle>
                <ArtifactDescription>
                  {state.setup.profile?.ready
                    ? "Your booking link is ready to share."
                    : nextStep(state.setup.nextAction)}
                </ArtifactDescription>
              </div>
            </ArtifactHeader>
            <ArtifactContent className="flex flex-col gap-3">
              {state.setup.profile?.ready && (
                <Button
                  render={<a href={`/${state.setup.profile.handle}`} />}
                  nativeButton={false}
                  variant="outline"
                >
                  Open your booking link
                </Button>
              )}
              <p className="text-sm text-muted-foreground">
                Google sign-in and calendar consent happen in your browser. Your
                chat resumes here afterward.
              </p>
            </ArtifactContent>
          </Artifact>
          {pending && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner />
              Saving your conversation…
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="Scroll to latest setup message" />
      </Conversation>
      <CardContent className="flex flex-col gap-4 pb-5">
        {error && (
          <>
            <Notice error>{error}</Notice>
            <Button variant="outline" onClick={refresh} disabled={pending}>
              Refresh setup state
            </Button>
          </>
        )}
        <Suggestions aria-label="Suggested setup messages">
          {[
            "I’m in Asia/Seoul",
            "Weekdays, 2–5 PM",
            "30-minute meetings with a 15-minute buffer",
          ].map((suggestion) => (
            <Suggestion
              key={suggestion}
              suggestion={suggestion}
              disabled={pending}
              onClick={(text) => controller.textInput.setInput(text)}
            />
          ))}
        </Suggestions>
        <PromptInput
          onSubmit={async ({ text }) => {
            if (!text.trim()) throw new Error("Enter a message first.")
            await mutate("/host/setup/conversation/messages", {
              text: text.trim(),
              expectedRevision: state.revision,
              clientTurnId: turnId(text.trim(), state.revision),
            })
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="Message about your host setup"
              placeholder="For example: I’m Dodo, in Seoul. Weekday afternoons work best…"
              disabled={pending}
              maxLength={4000}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <p className="text-xs text-muted-foreground">
              Enter to send · Shift + Enter for a new line
            </p>
            <PromptInputSubmit
              aria-label="Send setup message"
              disabled={pending || !controller.textInput.value.trim()}
              status={pending ? "submitted" : "ready"}
            />
          </PromptInputFooter>
        </PromptInput>
      </CardContent>
    </>
  )
}

function DraftReview({
  review,
  pending,
  onConfirm,
}: {
  review: SetupReview
  pending: boolean
  onConfirm: () => void
}) {
  const draft = review.settings
  const rules = draft.rules
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          Review your proposed settings
        </CardTitle>
        <CardDescription>
          Confirm this summary to save it. Sending a message keeps your saved
          rules unchanged until you confirm.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <ReviewValue label="Public name" value={draft.displayName} />
          <ReviewValue
            label="Booking link"
            value={
              draft.handle ? `${location.origin}/${draft.handle}` : undefined
            }
          />
          <ReviewValue label="Timezone" value={rules?.timezone} />
          <ReviewValue
            label="Meeting length"
            value={
              rules?.durationMinutes !== undefined
                ? `${rules.durationMinutes} minutes`
                : undefined
            }
          />
          <ReviewValue
            label="Availability"
            value={rules?.availability
              ?.map(
                (window) =>
                  `${window.days.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")} · ${window.start}–${window.end}`
              )
              .join("; ")}
          />
          <ReviewValue
            label="Buffer"
            value={
              rules?.bufferMinutes !== undefined
                ? `${rules.bufferMinutes} minutes`
                : undefined
            }
          />
          <ReviewValue label="Travel mode" value={rules?.travelMode} />
          <ReviewValue
            label="Usual location (private)"
            value={rules?.homeLocation}
          />
          <ReviewValue
            label="Preferences (private)"
            value={rules?.preferences || "None"}
          />
          <ReviewValue
            label="Focus blocks"
            value={
              rules?.focusBlocks?.length
                ? rules.focusBlocks
                    .map((block) => `${block.start} – ${block.end}`)
                    .join("; ")
                : "None"
            }
          />
        </dl>
      </CardContent>
      <CardFooter>
        <Button onClick={onConfirm} disabled={pending}>
          <CheckCircle2 data-icon="inline-start" />
          Confirm and save proposed settings
        </Button>
      </CardFooter>
    </Card>
  )
}
function ReviewValue({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value ?? "Not set"}</dd>
    </div>
  )
}

function IMessageSetup() {
  const resource = useResource<LinkState>("/host/imessage/link")
  const action = useAction()
  const [started, setStarted] = useState<LinkStart | null>(null)
  const [unlinked, setUnlinked] = useState(false)
  const [continuation] = useState(() => {
    const stored = sessionStorage.getItem("fmat-imessage-continuation")
    try {
      return stored
        ? (JSON.parse(stored) as {
            continuationId: string
            continuationSecret: string
          })
        : null
    } catch {
      return null
    }
  })
  const challenge = resource.data?.challenge
  const contact = started?.contactUrl ?? resource.data?.contactUrl
  const contactUrl =
    contact && /^(sms:|imessage:|https:\/\/)/.test(contact) ? contact : null
  return (
    <Card>
      <CardHeader>
        <CardTitle
          role="heading"
          aria-level={2}
          className="flex items-center gap-2"
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          Continue in iMessage
        </CardTitle>
        <CardDescription>
          Use the same setup conversation from your linked private chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {resource.loading ? (
          <Loading />
        ) : resource.error || !resource.data ? (
          <p className="text-sm text-muted-foreground">
            iMessage status is unavailable. Continue setup here.
          </p>
        ) : (
          <>
            <Badge variant={resource.data.link ? "default" : "secondary"}>
              {resource.data.link
                ? "Linked"
                : resource.data.available
                  ? "Available to link"
                  : "Not available yet"}
            </Badge>
            {!resource.data.available && (
              <p className="text-sm text-muted-foreground">
                The iMessage setup service is offline. Your website conversation
                remains available.
              </p>
            )}
            {resource.data.link && (
              <>
                <p className="text-sm">
                  Your private iMessage account is linked.
                </p>
                <Button
                  variant="outline"
                  disabled={action.pending}
                  onClick={() =>
                    action.run(
                      (key) =>
                        api<unknown>("/host/imessage/unlink", {
                          body: { linkId: resource.data!.link!.id },
                          idempotencyKey: key,
                        }),
                      () => {
                        setUnlinked(true)
                        setStarted(null)
                        resource.refresh()
                      }
                    )
                  }
                >
                  Unlink iMessage
                </Button>
              </>
            )}
            {resource.data.available &&
              !resource.data.link &&
              !started &&
              !challenge && (
                <Button
                  variant="outline"
                  disabled={action.pending}
                  onClick={() =>
                    action.run(
                      (key) =>
                        api<LinkStart>("/host/imessage/link/start", {
                          body: continuation ?? {},
                          idempotencyKey: key,
                        }),
                      (value) => {
                        sessionStorage.setItem(
                          `fmat-imessage-proof:${value.challengeId}`,
                          value.browserProof
                        )
                        setStarted(value)
                        sessionStorage.removeItem("fmat-imessage-continuation")
                        setUnlinked(false)
                        resource.refresh()
                      }
                    )
                  }
                >
                  Link iMessage
                </Button>
              )}
            {contactUrl && !resource.data.link && (started || challenge) && (
              <Button
                variant="outline"
                render={<a href={contactUrl} />}
                nativeButton={false}
              >
                Open the private iMessage chat
              </Button>
            )}
            {started && (
              <>
                <p className="text-sm">
                  Send this single-use challenge in the private Find Me a Time
                  iMessage chat:
                </p>
                <p className="text-sm break-all">
                  <strong>{started.challengeText}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires{" "}
                  {new Date(started.expiresAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  . Keep the code private.
                </p>
              </>
            )}
            {(started || challenge) && !resource.data.link && (
              <>
                <p className="text-sm text-muted-foreground">
                  After replying in iMessage, check the account observed here.
                  Only confirm an account you recognize.
                </p>
                <Button
                  variant="outline"
                  disabled={action.pending}
                  onClick={resource.refresh}
                >
                  Check linking progress
                </Button>
                {challenge?.claimed && challenge.senderLabel && (
                  <>
                    <p className="text-sm">
                      Confirm linking {challenge.senderLabel} to this host
                      account.
                    </p>
                    <Button
                      disabled={action.pending}
                      onClick={() =>
                        action.run(
                          (key) => {
                            const browserProof = sessionStorage.getItem(
                              `fmat-imessage-proof:${challenge.id}`
                            )
                            if (!browserProof)
                              throw new Error(
                                "Start a fresh link from this browser to confirm your iMessage account."
                              )
                            return api<unknown>("/host/imessage/link/confirm", {
                              body: { challengeId: challenge.id, browserProof },
                              idempotencyKey: key,
                            })
                          },
                          () => {
                            sessionStorage.removeItem(
                              `fmat-imessage-proof:${challenge.id}`
                            )
                            setStarted(null)
                            resource.refresh()
                          }
                        )
                      }
                    >
                      Confirm this iMessage account
                    </Button>
                  </>
                )}
              </>
            )}
            {unlinked && (
              <p role="status" className="text-sm">
                iMessage was unlinked. Continue setup here.
              </p>
            )}
          </>
        )}
        {action.error && <Notice error>{action.error}</Notice>}
      </CardContent>
    </Card>
  )
}

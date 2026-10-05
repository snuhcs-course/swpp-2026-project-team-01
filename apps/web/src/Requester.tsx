import { useState } from "react"
import { CalendarDays, Clock3, Settings2, ShieldCheck } from "lucide-react"
import type {
  HostProfile,
  MeetingDetails,
  MeetingMode,
  RequestView,
  TimeWindow,
} from "../../../packages/contracts/index"
import { api, rememberRequest } from "@/lib/api"
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
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Separator } from "@/components/ui/separator"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
export function Requester({ handle }: { handle: string }) {
  const host = useResource<HostProfile>(`/hosts/${encodeURIComponent(handle)}`)
  if (host.loading) return <Loading />
  if (host.error || !host.data)
    return (
      <ErrorState
        error={host.error || "This host could not be found."}
        retry={host.refresh}
      />
    )
  if (!host.data.ready)
    return (
      <Notice>
        This host is still setting up their booking link. Please contact them
        for availability.
      </Notice>
    )
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <aside className="flex min-w-0 flex-col gap-5">
        <div
          className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"
          aria-hidden="true"
        >
          <CalendarDays className="size-6" />
        </div>
        <div>
          <Badge variant="secondary">No account needed</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight break-words sm:text-4xl">
            Meet with {host.data.displayName}
          </h1>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            A good conversation starts here. Share what you have in mind and
            when you’re free. We’ll help find a time that works.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm">
          <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
          {host.data.durationMinutes}-minute meeting
        </p>
        <div className="hidden">
          <Separator />
        </div>
        <div className="sr-only">
          <h2 className="text-sm font-medium">What happens next</h2>
          <ol className="flex flex-col gap-5">
            {[
              [
                "Share your availability",
                "Start with a few windows that work for you.",
              ],
              [
                "Choose a proposal",
                "Review the exact time and meeting details.",
              ],
              [
                "Wait for host approval",
                "We’ll confirm once the calendar event is booked.",
              ],
            ].map(([title, description], index) => (
              <li key={title} className="flex gap-3">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            Private calendar details stay private. Nothing is booked until both
            people agree and the host approves.
          </p>
        </div>
      </aside>
      <Intake host={host.data} />
    </div>
  )
}
function Intake({ host }: { host: HostProfile }) {
  const [mode, setMode] = useState<MeetingMode>("online")
  const [windows, setWindows] = useState([{ start: "", end: "" }])
  const [purpose, setPurpose] = useState("")
  const [detailsOpen, setDetailsOpen] = useState(false)
  const action = useAction()
  const duration = host.durationMinutes
  return (
    <>
      <Card className="min-w-0 py-0">
        <CardHeader className="border-b py-5">
          <CardTitle role="heading" aria-level={2}>
            Plan with {host.displayName}
          </CardTitle>
          <CardDescription>
            Start with the reason for meeting. We’ll collect contact details and
            availability in a private request artifact.
          </CardDescription>
        </CardHeader>
        <Conversation
          className="h-[min(54svh,34rem)] min-h-80 flex-none"
          aria-label="New meeting request conversation"
        >
          <ConversationContent className="gap-5 p-5 md:p-6">
            <Message from="assistant">
              <MessageContent>
                What would you like to discuss with {host.displayName}?
              </MessageContent>
            </Message>
            {purpose && (
              <>
                <Message from="user">
                  <MessageContent>{purpose}</MessageContent>
                </Message>
                <Message from="assistant">
                  <MessageContent>
                    I’ve started your request. Add your contact details and a
                    few times that work so I can check availability.
                  </MessageContent>
                </Message>
                <Artifact>
                  <ArtifactHeader>
                    <div className="flex flex-col gap-1">
                      <ArtifactTitle>Meeting request draft</ArtifactTitle>
                      <ArtifactDescription>
                        {duration} minutes · {timezone}
                      </ArtifactDescription>
                    </div>
                  </ArtifactHeader>
                  <ArtifactContent className="flex flex-col gap-4">
                    <p className="text-sm whitespace-pre-wrap">{purpose}</p>
                    <Button onClick={() => setDetailsOpen(true)}>
                      Add contact and availability
                    </Button>
                  </ArtifactContent>
                </Artifact>
              </>
            )}
          </ConversationContent>
          <ConversationScrollButton aria-label="Scroll to latest request message" />
        </Conversation>
        <CardContent className="flex flex-col gap-4 pb-5">
          {!purpose && (
            <Suggestions aria-label="Suggested meeting requests">
              {[
                "Review a project idea",
                "Plan a research interview",
                "Schedule a quick introduction",
              ].map((suggestion) => (
                <Suggestion
                  key={suggestion}
                  suggestion={suggestion}
                  onClick={setPurpose}
                />
              ))}
            </Suggestions>
          )}
          <PromptInput
            aria-label="New meeting request"
            onSubmit={({ text }) => {
              const nextPurpose = text.trim()
              if (nextPurpose.length < 5)
                throw new Error(
                  "Describe the meeting in at least 5 characters."
                )
              setPurpose(nextPurpose)
            }}
          >
            <PromptInputBody>
              <PromptInputTextarea
                aria-label="What would you like to discuss?"
                maxLength={4000}
                placeholder="Tell me what you’d like to meet about…"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <span className="text-xs text-muted-foreground">
                Your host sees this after you submit the request.
              </span>
              <PromptInputSubmit aria-label="Continue request" />
            </PromptInputFooter>
          </PromptInput>
        </CardContent>
        <CardFooter className="justify-between border-t py-4">
          <p className="text-xs text-muted-foreground">
            Nothing is booked until both people agree.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDetailsOpen(true)}
          >
            <Settings2 data-icon="inline-start" />
            Request details
          </Button>
        </CardFooter>
      </Card>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex max-h-[90svh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>Request details</DialogTitle>
            <DialogDescription>
              Add the contact and availability details needed to create this
              private meeting request.
            </DialogDescription>
          </DialogHeader>
          <form
            className="max-h-[70svh] overflow-y-auto px-6 pb-6"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              const read = (name: string) => String(form.get(name) ?? "")
              const body: MeetingDetails = {
                requesterName: read("requesterName"),
                requesterEmail: read("requesterEmail"),
                purpose: read("purpose"),
                durationMinutes: Number(form.get("duration")),
                timezone: read("timezone"),
                mode,
                location: read("location"),
                windows: [],
              }
              action.run(
                (key) => {
                  new Intl.DateTimeFormat("en", { timeZone: body.timezone })
                  const parsed: TimeWindow[] = windows.map((window) => ({
                    start: new Date(window.start).toISOString(),
                    end: new Date(window.end).toISOString(),
                  }))
                  if (
                    parsed.some(
                      (window) =>
                        Date.parse(window.start) <= Date.now() ||
                        Date.parse(window.end) - Date.parse(window.start) <
                          body.durationMinutes * 60000
                    )
                  )
                    throw new Error(
                      "Choose future availability windows long enough for your meeting."
                    )
                  body.windows = parsed
                  return api<{ request: RequestView; token: string }>(
                    `/hosts/${encodeURIComponent(host.handle)}/requests`,
                    { body, idempotencyKey: key }
                  )
                },
                (value) => {
                  rememberRequest(value.request.id, value.token)
                  location.assign(`/requests/${value.request.id}`)
                },
                JSON.stringify([body, windows])
              )
            }}
          >
            <FieldGroup>
              <FieldGroup className="sm:flex-row">
                <TextField
                  name="requesterName"
                  label="Your name"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
                <TextField
                  name="requesterEmail"
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </FieldGroup>
              <Field>
                <FieldLabel htmlFor="purpose">
                  What would you like to discuss?
                </FieldLabel>
                <Textarea
                  id="purpose"
                  name="purpose"
                  required
                  minLength={5}
                  maxLength={4000}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="A quick introduction, feedback on an idea, or something else?"
                />
              </Field>
              <FieldGroup className="sm:flex-row">
                <TextField
                  name="duration"
                  label="Meeting length (host setting, minutes)"
                  type="number"
                  defaultValue={duration}
                  readOnly
                  required
                />
                <TextField
                  name="timezone"
                  label="Meeting timezone"
                  description="Used for displaying proposals. Availability inputs below use your browser timezone."
                  defaultValue={timezone}
                  required
                />
              </FieldGroup>
              <Field>
                <FieldLabel id="mode-label">
                  How would you like to meet?
                </FieldLabel>
                <ToggleGroup
                  aria-labelledby="mode-label"
                  value={[mode]}
                  onValueChange={(values) => {
                    if (values[0]) setMode(values[0] as MeetingMode)
                  }}
                  spacing={2}
                >
                  <ToggleGroupItem value="online">Online</ToggleGroupItem>
                  <ToggleGroupItem value="in_person">In person</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <TextField
                name="location"
                label={
                  mode === "in_person"
                    ? "Meeting address"
                    : "Meeting link or preference (optional)"
                }
                required={mode === "in_person"}
                maxLength={1000}
                description={
                  mode === "in_person"
                    ? "A specific address lets us account for the trip."
                    : "The final meeting link will appear in the confirmed calendar event."
                }
              />
              <FieldSet>
                <FieldLegend>When are you available?</FieldLegend>
                <FieldDescription>
                  Enter one or more windows in {timezone} (your browser
                  timezone). We’ll check times within these windows. Offered
                  times are not reserved.
                </FieldDescription>
                <FieldGroup>
                  {windows.map((window, i) => (
                    <FieldGroup key={i}>
                      <FieldGroup className="sm:flex-row">
                        <TextField
                          name={`window-start-${i}`}
                          label={`Window ${i + 1} starts`}
                          type="datetime-local"
                          required
                          value={window.start}
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
                          name={`window-end-${i}`}
                          label={`Window ${i + 1} ends`}
                          type="datetime-local"
                          required
                          value={window.end}
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
                      Add another window
                    </Button>
                  )}
                </FieldGroup>
              </FieldSet>
              {action.error && <Notice error>{action.error}</Notice>}
              <Submit pending={action.pending}>Start a meeting request</Submit>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDetailsOpen(false)}
              >
                Return to conversation
              </Button>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

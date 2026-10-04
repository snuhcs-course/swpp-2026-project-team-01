import { useState } from 'react'
import type { HostProfile, MeetingDetails, MeetingMode, RequestView, TimeWindow } from '../../../packages/contracts/index'
import { api, rememberRequest } from '@/lib/api'
import { ErrorState, Loading, Notice, Submit, TextField, useAction, useResource } from '@/lib/ui'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend, FieldDescription } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
export function Requester({ handle }: { handle: string }) {
  const host = useResource<HostProfile>(`/hosts/${encodeURIComponent(handle)}`)
  if (host.loading) return <Loading />
  if (host.error || !host.data) return <ErrorState error={host.error || 'This host could not be found.'} retry={host.refresh} />
  if (!host.data.ready) return <Notice>This host is still setting up their booking link. Please contact them for availability.</Notice>
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6"><div><Badge variant="secondary">No account needed</Badge><h1 className="mt-4 text-4xl font-semibold tracking-tight">Meet with {host.data.displayName}</h1><p className="mt-3 text-muted-foreground">Tell us a little about the meeting. We’ll find options and send your choice for review.</p></div><Intake host={host.data} /></div>
}
function Intake({ host }: { host: HostProfile }) {
  const [mode, setMode] = useState<MeetingMode>('online')
  const [windows, setWindows] = useState([{ start: '', end: '' }])
  const action = useAction()
  return <Card><CardHeader><CardTitle>What do you have in mind?</CardTitle><CardDescription>Your details will be shared with {host.displayName}. Calendar event details stay private.</CardDescription></CardHeader><CardContent><form onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); const read = (name: string) => String(form.get(name) ?? '')
    const body: MeetingDetails = { requesterName: read('requesterName'), requesterEmail: read('requesterEmail'), purpose: read('purpose'), durationMinutes: Number(form.get('duration')), timezone: read('timezone'), mode, location: read('location'), windows: [] }
    action.run(key => {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone })
      const parsed: TimeWindow[] = windows.map(window => ({ start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() }))
      if (parsed.some(window => Date.parse(window.start) <= Date.now() || Date.parse(window.end) - Date.parse(window.start) < body.durationMinutes * 60000)) throw new Error('Choose future availability windows long enough for your meeting.')
      body.windows = parsed
      return api<{ request: RequestView; token: string }>(`/hosts/${encodeURIComponent(host.handle)}/requests`, { body, idempotencyKey: key })
    }, value => { rememberRequest(value.request.id, value.token); location.assign(`/requests/${value.request.id}`) }, JSON.stringify([body, windows]))
  }}><FieldGroup>
    <FieldGroup className="sm:flex-row"><TextField name="requesterName" label="Your name" autoComplete="name" required maxLength={100} /><TextField name="requesterEmail" label="Email address" type="email" autoComplete="email" required maxLength={254} /></FieldGroup>
    <Field><FieldLabel htmlFor="purpose">What would you like to discuss?</FieldLabel><Textarea id="purpose" name="purpose" required minLength={5} maxLength={4000} placeholder="A quick introduction, feedback on an idea, or something else?" /></Field>
    <FieldGroup className="sm:flex-row"><TextField name="duration" label="Meeting length (minutes)" type="number" min={5} max={240} step={5} defaultValue={30} required /><TextField name="timezone" label="Meeting timezone" description="Used for displaying proposals. Availability inputs below use your browser timezone." defaultValue={timezone} required /></FieldGroup>
    <Field><FieldLabel id="mode-label">How would you like to meet?</FieldLabel><ToggleGroup aria-labelledby="mode-label" value={[mode]} onValueChange={values => { if (values[0]) setMode(values[0] as MeetingMode) }} spacing={2}><ToggleGroupItem value="online">Online</ToggleGroupItem><ToggleGroupItem value="in_person">In person</ToggleGroupItem></ToggleGroup></Field>
    <TextField name="location" label={mode === 'in_person' ? 'Meeting address' : 'Meeting link or preference (optional)'} required={mode === 'in_person'} maxLength={1000} description={mode === 'in_person' ? 'A specific address lets us account for the trip.' : 'The final meeting link will appear in the confirmed calendar event.'} />
    <FieldSet><FieldLegend>When are you available?</FieldLegend><FieldDescription>Enter one or more windows in {timezone} (your browser timezone). We’ll check times within these windows. Offered times are not reserved.</FieldDescription><FieldGroup>{windows.map((window,i) => <FieldGroup key={i}><FieldGroup className="sm:flex-row"><TextField name={`window-start-${i}`} label={`Window ${i+1} starts`} type="datetime-local" required value={window.start} onChange={e => setWindows(values => values.map((item,index) => index === i ? { ...item, start: e.target.value } : item))} /><TextField name={`window-end-${i}`} label={`Window ${i+1} ends`} type="datetime-local" required value={window.end} onChange={e => setWindows(values => values.map((item,index) => index === i ? { ...item, end: e.target.value } : item))} /></FieldGroup>{windows.length > 1 && <Button type="button" variant="ghost" onClick={() => setWindows(values => values.filter((_item,index) => index !== i))}>Remove window {i+1}</Button>}</FieldGroup>)}{windows.length < 8 && <Button type="button" variant="outline" onClick={() => setWindows(values => [...values, { start: '', end: '' }])}>Add another window</Button>}</FieldGroup></FieldSet>
    {action.error && <Notice error>{action.error}</Notice>}<Submit pending={action.pending}>Start a meeting request</Submit>
    </FieldGroup></form></CardContent><CardFooter><p className="text-sm text-muted-foreground">You can optionally connect Google Calendar after starting. Your host approves the current proposal before booking.</p></CardFooter></Card>
}

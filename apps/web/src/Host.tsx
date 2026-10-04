import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { CalendarOption, HostRules, SetupState } from '../../../packages/contracts/index'
import { api, configured, supabase } from '@/lib/api'
import { ErrorState, Loading, Notice, Submit, TextField, useAction, useResource } from '@/lib/ui'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend, FieldDescription } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const defaults: HostRules = { timezone: localZone, durationMinutes: 30, availability: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }], focusBlocks: [], bufferMinutes: 15, travelMode: 'TRANSIT', preferences: '' }

export function Host({ children }: { children?: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoading(false) })
    return () => data.subscription.unsubscribe()
  }, [])
  if (loading) return <Loading />
  if (!session) return <SignIn />
  return <div className="flex flex-col gap-6"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Signed in as {session.user.email}</p><Button variant="ghost" onClick={() => supabase?.auth.signOut()}>Sign out</Button></div>{children ?? <Workspace />}</div>
}
function SignIn() {
  const action = useAction()
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState('')
  return <Card className="mx-auto max-w-lg"><CardHeader><Badge variant="secondary">Host access</Badge><CardTitle>Welcome back.</CardTitle><CardDescription>Sign in to set up your calendar or review a meeting. Hosting is invite-only.</CardDescription></CardHeader><CardContent><form onSubmit={e => { e.preventDefault(); action.run(async () => { if (!supabase) throw new Error('Sign-in is being configured. Please try again later.'); const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/host${location.search}`, shouldCreateUser: true } }); if (error) throw error }, () => setSent(true)) }}><FieldGroup><TextField name="email" label="Email address" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />{sent && <Notice>Check your email for a secure sign-in link. You can return here after opening it.</Notice>}{action.error && <Notice error>{action.error}</Notice>}<Submit pending={action.pending}>Email me a sign-in link</Submit></FieldGroup></form></CardContent><CardFooter><p className="text-sm text-muted-foreground">Requesting a meeting through a host link does not require sign-in.</p></CardFooter></Card>
}
function Workspace() {
  const resource = useResource<SetupState>('/host/setup')
  if (resource.loading) return <Loading />
  if (resource.error || !resource.data) return <ErrorState error={resource.error || 'Setup could not be loaded.'} retry={resource.refresh} />
  return <div className="flex flex-col gap-6"><div><h1 className="text-3xl font-semibold tracking-tight">Your workspace</h1><p className="mt-2 text-muted-foreground">Set the boundaries. We’ll handle the back and forth.</p></div>{!resource.data.admitted ? <Admission onSaved={resource.setData} /> : <><Setup initial={resource.data} onSaved={resource.setData} /><InboxGate ready={resource.data.profile?.ready ?? false} /></>}</div>
}
function Admission({ onSaved }: { onSaved: (value: SetupState) => void }) {
  const [token, setToken] = useState(new URLSearchParams(location.search).get('invite') ?? '')
  const action = useAction()
  return <Card><CardHeader><CardTitle>A spot for your calendar</CardTitle><CardDescription>Redeem the invitation sent to your verified email address to start hosting.</CardDescription></CardHeader><CardContent><form onSubmit={e => { e.preventDefault(); action.run(key => api<SetupState>('/host/invitations/redeem', { body: { token }, idempotencyKey: key }), onSaved, token) }}><FieldGroup><TextField name="invitation" label="Invitation token" required value={token} onChange={e => setToken(e.target.value)} autoComplete="off" />{action.error && <Notice error>{action.error}</Notice>}<Submit pending={action.pending}>Redeem invitation</Submit></FieldGroup></form></CardContent><CardFooter><Button variant="outline" render={<a href="/#waitlist" />} nativeButton={false}>Join the waitlist</Button></CardFooter></Card>
}
function Setup({ initial, onSaved }: { initial: SetupState; onSaved: (value: SetupState) => void }) {
  const rules = initial.rules ?? defaults
  const [days, setDays] = useState(rules.availability[0]?.days ?? [1,2,3,4,5])
  const action = useAction()
  const [saved, setSaved] = useState(false)
  return <div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>Your scheduling rules</CardTitle><CardDescription>Review these settings before saving. Your rules and private locations stay private.</CardDescription></CardHeader><CardContent><form onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); const string = (name: string) => String(form.get(name) ?? '')
    const start = string('start'); const end = string('end')
    action.run(key => {
      if (!days.length || start >= end) throw new Error('Choose at least one day and an end time after the start time.')
      const zone = string('timezone'); new Intl.DateTimeFormat('en', { timeZone: zone })
      const focusStart = string('focusStart'); const focusEnd = string('focusEnd')
      const focusBlocks = focusStart && focusEnd ? [{ start: new Date(focusStart).toISOString(), end: new Date(focusEnd).toISOString() }] : rules.focusBlocks
      return api<SetupState>('/host/setup', { idempotencyKey: key, body: { handle: string('handle'), displayName: string('displayName'), rules: { timezone: zone, durationMinutes: Number(form.get('duration')), availability: [{ days, start, end }], focusBlocks, bufferMinutes: Number(form.get('buffer')), travelMode: string('travelMode'), homeLocation: string('homeLocation'), preferences: string('preferences') } } })
    }, value => { onSaved(value); setSaved(true) }, JSON.stringify([...form.entries(), days]))
  }}><FieldGroup>
    <TextField name="displayName" label="Display name" required defaultValue={initial.profile?.displayName ?? ''} autoComplete="name" />
    <TextField name="handle" label="Booking link handle" description="Your public link: findmeatime.com/your-handle" pattern="[a-z0-9][a-z0-9-]{2,29}" minLength={3} maxLength={30} required defaultValue={initial.profile?.handle ?? ''} />
    <TextField name="timezone" label="Timezone" description="Use a location timezone, such as Asia/Seoul or America/New_York." required defaultValue={rules.timezone} />
    <TextField name="duration" label="Default meeting length (minutes)" type="number" min={5} max={240} step={5} required defaultValue={rules.durationMinutes} />
    <Field><FieldLabel id="days-label">Available days</FieldLabel><ToggleGroup multiple value={days.map(String)} onValueChange={values => setDays(values.map(Number))} aria-labelledby="days-label" spacing={1} className="flex-wrap">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i) => <ToggleGroupItem key={day} value={String(i)} aria-label={day}>{day}</ToggleGroupItem>)}</ToggleGroup></Field>
    <FieldGroup className="sm:flex-row"><TextField name="start" label="Available from" type="time" required defaultValue={rules.availability[0]?.start ?? '09:00'} /><TextField name="end" label="Until" type="time" required defaultValue={rules.availability[0]?.end ?? '17:00'} /></FieldGroup>
    <TextField name="buffer" label="Buffer between meetings (minutes)" type="number" min={0} max={180} required defaultValue={rules.bufferMinutes} />
    <FieldSet><FieldLegend>Protect focus time (optional)</FieldLegend><FieldDescription>These timestamps use your browser timezone, {localZone}. Existing focus blocks are retained unless you enter a replacement.</FieldDescription><FieldGroup className="sm:flex-row"><TextField name="focusStart" label="Focus block starts" type="datetime-local" /><TextField name="focusEnd" label="Focus block ends" type="datetime-local" /></FieldGroup></FieldSet>
    <Field><FieldLabel htmlFor="travelMode">Travel mode</FieldLabel><NativeSelect name="travelMode" id="travelMode" defaultValue={rules.travelMode}>{[['TRANSIT','Public transport'],['DRIVE','Driving'],['WALK','Walking'],['BICYCLE','Bicycle']].map(([value,label]) => <NativeSelectOption value={value} key={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
    <TextField name="homeLocation" label="Usual location (private, optional)" defaultValue={rules.homeLocation ?? ''} />
    <Field><FieldLabel htmlFor="preferences">Preferences (private)</FieldLabel><Textarea name="preferences" id="preferences" defaultValue={rules.preferences} placeholder="Anything you would like considered when reviewing requests" /></Field>
    {action.error && <Notice error>{action.error}</Notice>}{saved && <Notice>Your settings have been saved.</Notice>}<Submit pending={action.pending}>Confirm and save rules</Submit>
  </FieldGroup></form></CardContent><CardFooter><p className="text-sm text-muted-foreground">Every meeting still needs your explicit approval.</p></CardFooter></Card><CalendarSetup initial={initial} onSaved={onSaved} /></div>
}
function CalendarSetup({ initial, onSaved }: { initial: SetupState; onSaved: (value: SetupState) => void }) {
  const action = useAction()
  const calendars = useResource<{ calendars: CalendarOption[] }>(initial.calendarConnected ? '/host/calendars' : null)
  const [conflictIds, setConflictIds] = useState(initial.conflictCalendarIds)
  const [bookingId, setBookingId] = useState(initial.bookingCalendarId ?? '')
  return <Card className="h-fit"><CardHeader><CardTitle>Your calendars</CardTitle><CardDescription>Choose calendars to check for conflicts and one writable calendar for confirmed bookings.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5"><Badge variant={initial.calendarConnected ? 'default' : 'secondary'}>{initial.calendarConnected ? 'Google Calendar connected' : 'Calendar connection needed'}</Badge>
    {initial.profile?.ready && <Notice>Your booking link is ready: <a href={`/${initial.profile.handle}`} className="break-all underline">{location.origin}/{initial.profile.handle}</a></Notice>}
    {initial.calendarConnected && calendars.loading && <Loading />}
    {calendars.error && <ErrorState error={calendars.error} retry={calendars.refresh} />}
    {initial.calendarConnected && calendars.data && <form onSubmit={e => { e.preventDefault(); action.run(key => api<SetupState>('/host/calendar-settings', { idempotencyKey: key, body: { conflictCalendarIds: conflictIds, bookingCalendarId: bookingId } }), onSaved, JSON.stringify([conflictIds, bookingId])) }}><FieldGroup><FieldSet><FieldLegend>Conflict calendars</FieldLegend><FieldDescription>Busy times on selected calendars are protected.</FieldDescription><FieldGroup>{calendars.data.calendars.map(calendar => <Field orientation="horizontal" key={calendar.id}><Checkbox id={`calendar-${calendar.id}`} checked={conflictIds.includes(calendar.id)} onCheckedChange={checked => setConflictIds(value => checked ? [...value, calendar.id] : value.filter(id => id !== calendar.id))} /><FieldLabel htmlFor={`calendar-${calendar.id}`}>{calendar.summary}</FieldLabel></Field>)}</FieldGroup></FieldSet><Field><FieldLabel htmlFor="bookingCalendar">Booking destination</FieldLabel><NativeSelect id="bookingCalendar" required value={bookingId} onChange={e => setBookingId(e.target.value)}><NativeSelectOption value="">Choose a writable calendar</NativeSelectOption>{calendars.data.calendars.filter(c => ['owner','writer'].includes(c.accessRole)).map(c => <NativeSelectOption key={c.id} value={c.id}>{c.summary}</NativeSelectOption>)}</NativeSelect></Field><Submit pending={action.pending}>Save calendar selection</Submit></FieldGroup></form>}
    {action.error && <Notice error>{action.error}</Notice>}
    <Button disabled={action.pending || !configured} onClick={() => action.run(key => api<{ url: string }>('/host/google/connect', { body: {}, idempotencyKey: key }), value => { location.assign(value.url) })}>{initial.calendarConnected ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</Button>
    {initial.calendarConnected && <Button variant="outline" disabled={action.pending} onClick={() => action.run(key => api<SetupState>('/host/calendar/disconnect', { body: {}, idempotencyKey: key }), onSaved, 'disconnect')}>Disconnect calendar access</Button>}
    </CardContent><CardFooter><p className="text-sm text-muted-foreground">A connection error requires reconnection. Your calendar is never assumed to be free.</p></CardFooter></Card>
}
function InboxGate({ ready }: { ready: boolean }) {
  return <Card><CardHeader><CardTitle>Meeting requests</CardTitle><CardDescription>{ready ? 'Review, revise, or approve a current proposal.' : 'Complete admission, rules, and calendar selection to publish your link.'}</CardDescription></CardHeader><CardContent><Button render={<a href="/host/inbox" />} nativeButton={false} variant="outline">Open inbox</Button></CardContent></Card>
}

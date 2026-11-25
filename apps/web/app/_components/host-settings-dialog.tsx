"use client";

import type { LocationAnswer, WeeklyWindow } from "@lib/contracts/setup";
import { SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cleanHostNotes, HOST_NOTES_MAX_LENGTH } from "@lib/contracts/host-notes";
import { DeleteAccountCard } from "@/app/_components/delete-account-card";
import { AssistantNotesField } from "@/app/_components/setup/assistant-notes-card";
import { describeLocation, weeklyPreview } from "@/app/_components/setup/format";
import { WeeklyWindowsEditor } from "@/app/_components/setup/weekly-windows-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { browserTimeZone, readSetupState, runSetupCommand, type SetupState } from "@/lib/setup/client";

type Intake = { accepting: boolean; revision: number; confirmedWindows?: WeeklyWindow[] | null; confirmedTimezone?: string | null; handle?: string | null };

// /app?settings=account opens the dialog at the Delete account card, the link
// Thyme sends when a host asks to delete their account
// (self-service-account-deletion D6).
const SETTINGS_PARAM = "settings";

function editableLocation(answer: LocationAnswer | null | undefined) {
  return answer?.kind === "places" && answer.areas.length === 1 && answer.venue === null ? answer.areas[0] ?? "" : "";
}


// What the server did with a change of confirmed settings (setup-saved-change).
type SavedChange = "saved" | "not_ready" | "unchanged" | "incomplete" | "calendar_unavailable" | "destination_not_writable" | "not_saved";

function savedChangeNotice(savedChange: SavedChange | undefined) {
  if (savedChange === "saved") return "Saved. Guests now see your new settings.";
  if (savedChange === "unchanged" || savedChange === undefined) return "";
  if (savedChange === "calendar_unavailable") return "Your change is recorded, but Google Calendar could not be read, so guests still see your previous settings. Try again in a moment.";
  if (savedChange === "destination_not_writable") return "Your change is recorded, but bookings can no longer be added to your booking calendar. Choose another calendar so guests see your new settings.";
  return "Your change is recorded, but guests still see your previous settings. Review and confirm the changes below.";
}

export function HostSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [intake, setIntake] = useState<Intake | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [limitRaw, setLimitRaw] = useState("");
  const [locationRaw, setLocationRaw] = useState("");
  const [initialLocation, setInitialLocation] = useState("");
  const [focusDeletion, setFocusDeletion] = useState(false);
  const [focusWeeklyLimit, setFocusWeeklyLimit] = useState(false);
  const [notesRaw, setNotesRaw] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const target = url.searchParams.get(SETTINGS_PARAM);
    if (target !== "account" && target !== "weekly-limit") return;
    url.searchParams.delete(SETTINGS_PARAM);
    window.history.replaceState(window.history.state, "", url);
    setFocusDeletion(target === "account");
    setFocusWeeklyLimit(target === "weekly-limit");
    setOpen(true);
  }, []);

  // Notes the host is typing survive a refresh after another setting's save.
  async function refresh(resetNotes = false) {
    const [nextSetup, response] = await Promise.all([
      readSetupState(browserTimeZone()),
      fetch("/api/host/settings", { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error("Settings could not be loaded.");
    setSetup(nextSetup);
    setIntake((await response.json()) as Intake);
    setLimitRaw(nextSetup.fields.weeklyLimit.proposed?.value?.toString() ?? "");
    const location = editableLocation(nextSetup.fields.location.proposed?.value);
    setLocationRaw(location);
    setInitialLocation(location);
    if (resetNotes) setNotesRaw(nextSetup.assistantNotes?.text ?? "");
  }

  useEffect(() => {
    if (!open) return;
    void refresh(true).catch(() => setNotice("Settings could not be loaded. Close and try again."));
  }, [open]);

  async function saveWindows(windows: WeeklyWindow[]) {
    if (!setup) return;
    setBusy(true);
    const result = await runSetupCommand<{ revision: number; savedChange?: SavedChange }>({
      expectedRevision: setup.draft.revision,
      input: { action: "adjust", field: "weeklyWindows", value: windows },
      operation: "setup.update_draft",
      retryKey: crypto.randomUUID(),
    });
    setBusy(false);
    if (result.kind !== "ok") { setNotice(result.message); await refresh(); return; }
    setEditing(false);
    setNotice(savedChangeNotice(result.result.savedChange));
    await refresh();
  }

  async function confirmSettings() {
    if (!setup) return;
    setBusy(true);
    const result = await runSetupCommand({
      expectedRevision: setup.draft.revision,
      input: { proposalHash: setup.proposalHash },
      operation: "setup.confirm_settings",
      retryKey: crypto.randomUUID(),
    });
    setBusy(false);
    setNotice(result.kind === "ok" ? "Your public schedule is updated." : result.message);
    await refresh();
  }

  async function savePreferences() {
    if (!setup) return;
    const rawLimit = limitRaw.trim();
    const limit = rawLimit === "" ? null : Number(rawLimit);
    const location = locationRaw.trim();
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
      setNotice("Enter 1–50 meetings per week, or leave the field empty for no limit.");
      return;
    }
    if (location !== initialLocation && (location.length < 1 || location.length > 100)) {
      setNotice("Enter a preferred area or venue of up to 100 characters.");
      return;
    }

    const changes: { field: "weeklyLimit" | "location"; value: number | null | LocationAnswer }[] = [];
    if (limit !== (setup.fields.weeklyLimit.proposed?.value ?? null)) changes.push({ field: "weeklyLimit", value: limit });
    if (location !== initialLocation) changes.push({ field: "location", value: { kind: "places", areas: [location], venue: null } });
    if (changes.length === 0) return;

    setBusy(true);
    let revision = setup.draft.revision;
    let savedChange: SavedChange | undefined;
    for (const change of changes) {
      const result = await runSetupCommand<{ revision: number; savedChange?: SavedChange }>({
        expectedRevision: revision,
        input: { action: "adjust", field: change.field, value: change.value },
        operation: "setup.update_draft",
        retryKey: crypto.randomUUID(),
      });
      if (result.kind !== "ok") {
        setBusy(false);
        setNotice(result.message);
        await refresh();
        return;
      }
      revision = result.result.revision;
      savedChange = result.result.savedChange;
    }
    setBusy(false);
    setNotice(savedChangeNotice(savedChange));
    await refresh();
  }

  // The notes for Thyme are saved at once and never need a confirmation
  // (host-preference-notes).
  async function saveNotes() {
    const notes = cleanHostNotes(notesRaw);
    if (notes.length > HOST_NOTES_MAX_LENGTH) {
      setNotice(`Keep the notes to ${HOST_NOTES_MAX_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    const result = await runSetupCommand({
      expectedRevision: null,
      input: { notes },
      operation: "setup.save_assistant_notes",
      retryKey: crypto.randomUUID(),
    });
    setBusy(false);
    setNotice(result.kind === "ok" ? (notes.length > 0 ? "Saved. Thyme keeps these notes in mind with your guests." : "Saved. Thyme has no notes now.") : result.message);
    await refresh(result.kind === "ok");
  }

  async function setAccepting(accepting: boolean) {
    if (!intake) return;
    setBusy(true);
    try {
      const response = await fetch("/api/host/settings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accepting, revision: intake.revision, retryKey: crypto.randomUUID() }),
      });
      const body = await response.json() as Intake & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "This setting could not be saved.");
      setIntake({ ...intake, ...body });
      setNotice(accepting ? "New meeting requests are enabled." : "New meeting requests are paused.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This setting could not be saved.");
      try { await refresh(); } catch { setNotice("This setting could not be saved. Close and try again."); }
    } finally { setBusy(false); }
  }

  const windows = setup?.fields.weeklyWindows.proposed?.value ?? null;
  const confirmedWindows = intake?.confirmedWindows ?? null;
  const displayWindows = setup?.pendingChanges && windows ? windows : confirmedWindows;
  const timezone = intake?.confirmedTimezone ?? setup?.fields.timezone.proposed?.value ?? "Not set";
  const locationAnswer = setup?.fields.location.proposed?.value;
  const notesDirty = Boolean(setup && cleanHostNotes(notesRaw) !== (setup.assistantNotes?.text ?? ""));
  const preferenceDirty = Boolean(setup && (limitRaw.trim() !== (setup.fields.weeklyLimit.proposed?.value?.toString() ?? "") || locationRaw.trim() !== initialLocation));

  return (
    <Dialog onOpenChange={(next) => { if (!next && editing && !window.confirm("Discard your unsaved window edits?")) return; if (!next) { setEditing(false); setFocusDeletion(false); } setOpen(next); }} open={open}>
      <DialogTrigger asChild>
        <Button aria-label="Open settings" size="icon" type="button" variant="ghost"><SettingsIcon aria-hidden className="size-5" /></Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden bg-secondary text-card-foreground sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="-mr-2 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-2">
          {setup && intake ? (
            <div className="flex flex-col gap-3">
              <section className="rounded-2xl bg-card p-4 sm:p-5" aria-label="Weekly availability">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Available times</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Meeting time zone: {timezone.replaceAll("_", " ")}</p>
                  </div>
                  {!editing ? <Button disabled={busy} onClick={() => setEditing(true)} size="sm" type="button" variant="outline">Edit times</Button> : null}
                </div>
                {editing ? <WeeklyWindowsEditor initial={windows} onCancel={() => setEditing(false)} onSave={(value) => void saveWindows(value)} saving={busy} /> : (
                  <>
                    {displayWindows ? (
                      <div aria-label="Weekly available times" className="mt-3 grid grid-cols-1 gap-x-5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-4">
                        {weeklyPreview(displayWindows).map((day) => (
                          <div className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-2 border-t border-border py-1.5 text-sm" key={day.weekday}>
                            <abbr className="font-medium no-underline" title={day.label}>{day.label.slice(0, 3)}</abbr>
                            <span className={`min-w-0 break-words ${day.ranges.length ? "" : "text-muted-foreground"}`}>{day.ranges.length ? day.ranges.join(", ") : "Unavailable"}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="mt-3 text-sm text-muted-foreground">No confirmed windows yet.</p>}
                  </>
                )}
              </section>
              <section className="space-y-4 rounded-2xl bg-card p-4 sm:p-5" aria-label="Meeting preferences">
                <h3 className="font-semibold">Meeting preferences</h3>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="font-medium" htmlFor="settings-weekly-limit">
                    Weekly meeting limit
                    <span className="block text-sm font-normal text-muted-foreground">Leave empty for no limit · 1–50</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input autoFocus={focusWeeklyLimit} className="h-10 w-16 bg-card text-center" disabled={busy} id="settings-weekly-limit" max={50} min={1} onChange={(event) => setLimitRaw(event.target.value)} type="number" value={limitRaw} />
                    <span className="text-sm text-muted-foreground">meetings / week</span>
                  </div>
                </div>
                <div>
                  <label className="font-medium" htmlFor="settings-location">Preferred meeting location</label>
                  <Input className="mt-2 bg-card" disabled={busy} id="settings-location" maxLength={100} onChange={(event) => setLocationRaw(event.target.value)} placeholder="Enter an area or venue" value={locationRaw} />
                  {locationAnswer && !editableLocation(locationAnswer) ? <p className="mt-1 text-sm text-muted-foreground">Current: {describeLocation(locationAnswer)}</p> : null}
                  <p className="mt-1 text-sm text-muted-foreground">Used when suggesting in-person meetings.</p>
                </div>
              </section>
              <section className="space-y-3 rounded-2xl bg-card p-4 sm:p-5" aria-label="Notes for Thyme">
                <AssistantNotesField disabled={busy} id="settings-assistant-notes" onChange={setNotesRaw} value={notesRaw} />
                {notesDirty ? (
                  <Button disabled={busy || cleanHostNotes(notesRaw).length > HOST_NOTES_MAX_LENGTH} onClick={() => void saveNotes()} size="sm" type="button">
                    {busy ? "Saving..." : "Save notes"}
                  </Button>
                ) : null}
              </section>
              <section className="space-y-2 rounded-2xl bg-card p-5" aria-label="New requests">
                <label className="intake-toggle flex min-h-11 items-center justify-between gap-4 font-medium">
                  Accept new meeting requests
                  <span className="shrink-0">
                    <input aria-label="Accept new meeting requests" checked={intake.accepting} disabled={busy || !setup.readiness.ready} onChange={(event) => void setAccepting(event.target.checked)} type="checkbox" className="sr-only" />
                    <span aria-hidden="true" className="intake-switch" />
                  </span>
                </label>
                <p className="text-sm text-muted-foreground">{!setup.readiness.ready ? "Complete setup or reconnect your calendar before receiving requests." : intake.accepting ? "New guests can send requests." : "New requests are paused. Existing requests remain available."}</p>
              </section>
              {preferenceDirty || setup.pendingChanges ? (
                <div className="flex items-center justify-between gap-3 px-1">
                  {preferenceDirty ? <Button disabled={busy || editing} onClick={() => void savePreferences()} type="button">{busy ? "Saving..." : "Save changes"}</Button>
                    : <Button disabled={busy || editing || setup.missingFields.length > 0} onClick={() => void confirmSettings()} type="button">Review and confirm changes</Button>}
                </div>
              ) : null}
              <DeleteAccountCard focus={focusDeletion} handle={intake.handle ?? null} />
            </div>
          ) : <p role="status">Loading settings…</p>}
          {notice ? <p role="status" className="text-sm">{notice}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import type { WeeklyWindow } from "@lib/contracts/setup";
import { SettingsIcon } from "lucide-react";
import "@/app/_components/ink/ink.css";
import { useEffect, useState } from "react";
import { summarizeWindows } from "@/app/_components/setup/format";
import { WeeklyWindowsEditor } from "@/app/_components/setup/weekly-windows-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { browserTimeZone, readSetupState, runSetupCommand, type SetupState } from "@/lib/setup/client";

type Intake = { accepting: boolean; revision: number; confirmedWindows?: WeeklyWindow[] | null; confirmedTimezone?: string | null };

export function HostSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [intake, setIntake] = useState<Intake | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function refresh() {
    const [nextSetup, response] = await Promise.all([
      readSetupState(browserTimeZone()),
      fetch("/api/host/settings", { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error("Settings could not be loaded.");
    setSetup(nextSetup);
    setIntake((await response.json()) as Intake);
  }

  useEffect(() => {
    if (!open) return;
    void refresh().catch(() => setNotice("Settings could not be loaded. Close and try again."));
  }, [open]);

  async function saveWindows(windows: WeeklyWindow[]) {
    if (!setup) return;
    setBusy(true);
    const result = await runSetupCommand({
      expectedRevision: setup.draft.revision,
      input: { action: "adjust", field: "weeklyWindows", value: windows },
      operation: "setup.update_draft",
      retryKey: crypto.randomUUID(),
    });
    setBusy(false);
    if (result.kind !== "ok") { setNotice(result.message); await refresh(); return; }
    setEditing(false);
    setNotice("Windows saved as a draft. Review and confirm them to update your public schedule.");
    await refresh();
  }

  async function confirmWindows() {
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
  const timezone = intake?.confirmedTimezone ?? setup?.fields.timezone.proposed?.value ?? "Not set";

  return (
    <Dialog onOpenChange={(next) => { if (!next && editing && !window.confirm("Discard your unsaved window edits?")) return; if (!next) setEditing(false); setOpen(next); }} open={open}>
      <DialogTrigger asChild>
        <Button aria-label="Open settings" size="icon" type="button" variant="ghost"><SettingsIcon aria-hidden className="size-5" /></Button>
      </DialogTrigger>
      <DialogContent className="onboarding-ink max-h-[calc(100dvh-2rem)] overflow-y-auto border-border bg-card text-card-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your available times and new meeting requests.</DialogDescription>
        </DialogHeader>
        {setup && intake ? (
          <div className="flex flex-col gap-6">
            <section className="space-y-3" aria-label="Weekly availability">
              <h3 className="font-semibold">Available times</h3>
              <p className="text-sm text-muted-foreground">Meeting time zone: {timezone.replaceAll("_", " ")}</p>
              {setup.pendingChanges ? <p className="text-sm text-warning">Changes are pending confirmation. Your previous schedule is still public.</p> : null}
              {editing ? <WeeklyWindowsEditor initial={windows} onCancel={() => setEditing(false)} onSave={(value) => void saveWindows(value)} saving={busy} /> : (
                <>
                  <p className="text-sm">{confirmedWindows ? summarizeWindows(confirmedWindows) : "No confirmed windows yet."}</p>
                  {setup.pendingChanges && windows ? <p className="text-sm text-muted-foreground">Pending: {summarizeWindows(windows)}</p> : null}
                  <Button onClick={() => setEditing(true)} type="button" variant="outline">Edit available times</Button>
                </>
              )}
              {setup.pendingChanges && !editing ? <Button disabled={busy || setup.missingFields.length > 0} onClick={() => void confirmWindows()} type="button">Review and confirm changes</Button> : null}
            </section>
            <section className="space-y-2 border-t pt-4" aria-label="New requests">
              <label className="intake-toggle flex min-h-11 items-center justify-between gap-4 font-medium">
                Accept new meeting requests
                <span className="shrink-0">
                  <input aria-label="Accept new meeting requests" checked={intake.accepting} disabled={busy || !setup.readiness.ready} onChange={(event) => void setAccepting(event.target.checked)} type="checkbox" className="sr-only" />
                  <span aria-hidden="true" className="intake-switch" />
                </span>
              </label>
              <p className="text-sm text-muted-foreground">{!setup.readiness.ready ? "Complete setup or reconnect your calendar before receiving requests." : intake.accepting ? "New guests can send requests." : "New requests are paused. Existing requests remain available."}</p>
            </section>
          </div>
        ) : <p role="status">Loading settings…</p>}
        {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

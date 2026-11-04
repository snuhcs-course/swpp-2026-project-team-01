import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runCommand } from "../../lib/server/commands";
import { createHostScheduleImageHandler } from "../../lib/server/host-schedule-image";
import { readSetupState } from "../../lib/server/setup";
import { suggestImageWindowsCommand, updateDraftCommand } from "../../lib/server/setup-commands";
import { localAuthConfig, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { draftRevision, hostCommandDeps, SETUP_ORIGIN, setupDependencies } from "./support/setup-host";

const db = testDatabase();
let google: FakeGoogle | null = null;
afterAll(async () => { await google?.close(); await db.end(); });

function upload(cookie: string, file: File) {
  const form = new FormData();
  form.set("image", file);
  return new Request(`${SETUP_ORIGIN}/api/setup/schedule-image`, {
    body: form, headers: { cookie, origin: SETUP_ORIGIN }, method: "POST",
  });
}

function image() {
  return new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64")], "timetable.png", { type: "image/png" });
}

describe("host schedule image", () => {
  it("requires a signed-in host and returns review hours without saving them", async () => {
    google = await startFakeGoogle();
    const host = await signInHost(db);
    const deps = { ...setupDependencies(db, google), appOrigin: SETUP_ORIGIN, auth: localAuthConfig(), extract: async () => [{ weekday: "monday", start: "09:00", end: "12:00" }] };
    const handler = createHostScheduleImageHandler(() => deps);
    expect((await handler(upload("", image()))).status).toBe(401);
    const response = await handler(upload(host.cookie, image()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ windows: [{ weekday: "monday", start: "09:00", end: "12:00" }] });
    const [draft] = await db<{ fields: Record<string, unknown> }[]>`select fields from app.setup_drafts where host_account_id = ${host.hostAccountId}`;
    expect(draft?.fields.weeklyWindows).toBeUndefined();
  });

  it("rejects image text in the extracted shape and unsupported files", async () => {
    google ??= await startFakeGoogle();
    const host = await signInHost(db);
    const deps = { ...setupDependencies(db, google), appOrigin: SETUP_ORIGIN, auth: localAuthConfig(), extract: async () => [{ weekday: "monday", start: "09:00", end: "12:00", title: "private class" }] };
    const handler = createHostScheduleImageHandler(() => deps);
    expect((await handler(upload(host.cookie, new File(["not an image"], "fake.png", { type: "image/png" })))).status).toBe(415);
    const result = await handler(upload(host.cookie, image()));
    expect(result.status).toBe(200);
    expect(JSON.stringify(await result.json())).not.toContain("private class");
  });

  it("shows image hours as an unaccepted weekly suggestion until the host chooses them", async () => {
    google ??= await startFakeGoogle();
    const host = await signInHost(db);
    const hours = [{ weekday: "monday" as const, start: "09:00", end: "12:00" }];
    expect(await runCommand(hostCommandDeps(db, host.hostAccountId), suggestImageWindowsCommand, {
      expectedRevision: await draftRevision(db, host.hostAccountId),
      input: { weeklyWindows: hours },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    })).toMatchObject({ ok: true });
    const state = await readSetupState(setupDependencies(db, google), host.hostAccountId);
    expect(state!.fields.weeklyWindows.proposed).toMatchObject({ accepted: false, source: "schedule_image", value: hours });
    expect(state!.nextAction).toBe("connect_calendar");
    const accepted = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
      expectedRevision: await draftRevision(db, host.hostAccountId),
      input: { action: "use_suggestion", field: "weeklyWindows", shown: hours },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    });
    expect(accepted).toMatchObject({ ok: true });
    expect((await readSetupState(setupDependencies(db, google), host.hostAccountId))!.fields.weeklyWindows.proposed)
      .toMatchObject({ accepted: true, source: "schedule_image", value: hours });
  });
});

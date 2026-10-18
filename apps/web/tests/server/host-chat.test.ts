// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import { describe, expect, it } from "vitest"
import { hostChatViewSchema } from "@/contracts/host-chat"
import { makeContext } from "@/server/runtime"
import { hostChatSend, hostChatView } from "@/server/services/host-chat"
import { patchDraft } from "@/server/services/profile"
import { emptyDb } from "./helpers"

async function host() {
  const store = await emptyDb()
  await store.sqlite.exec("INSERT INTO users(id,name) VALUES ('u','U')")
  return { ...store, ctx: makeContext(store.db) }
}
const texts = (view: { messages: { text: string }[] }) => view.messages.map((m) => m.text)

describe("host chat contract", () => {
  it("greets a new host in the chosen language and has nothing to send back yet", async () => {
    const { db, sqlite } = await host(); try {
      const en = hostChatViewSchema.parse(await hostChatView(db, "u", "en"))
      expect(texts(en)).toEqual(["Hi, I'm Thyme.", "Which days and hours do you usually work? No fixed hours is fine too."])
      expect(en).toMatchObject({ replies: [], revision: null })
      expect(texts(await hostChatView(db, "u", "ko"))[0]).toBe("안녕하세요, Thyme이에요.")
    } finally { sqlite.close() }
  })

  it("starts the draft with the first message and applies a retried message once", async () => {
    const { ctx, sqlite } = await host(); try {
      const send = { revision: null, text: "I have no fixed work hours.", locale: "en" as const }
      const first = await hostChatSend(ctx, "u", send, { key: "m1" })
      expect(first.messages.filter((m) => m.from === "host").map((m) => m.text)).toEqual(["I have no fixed work hours."])
      expect(first.revision).toBe(1)
      expect(await hostChatSend(ctx, "u", send, { key: "m1" })).toEqual(first)
      expect((await sqlite.prepare("SELECT count(*) n FROM draft_messages").get())).toEqual({ n: 2 })
    } finally { sqlite.close() }
  })

  it("proposes the finished draft, confirms it once, then shows the booking link", async () => {
    const { ctx, sqlite } = await host(); try {
      const started = await hostChatSend(ctx, "u", { revision: null, text: "hello there", locale: "en" }, { key: "m1" })
      const draftId = ((await sqlite.prepare("SELECT id FROM profile_drafts").get()) as { id: string }).id
      await patchDraft(ctx, "u", { draftId, expectedRevision: started.revision!, patch: {
        work: { mode: "none", windows: [] },
        meetingWindows: [1, 2, 3].map((weekday) => ({ weekday, startMin: 780, endMin: 1080 })),
        preferences: { weekdays: null, startTime: null, meetingMode: { value: "online", strength: "weak" }, slack: null },
      }, topicConfirmations: { work: "confirmed", meetingWindows: "confirmed", preferences: "confirmed" } }, { key: "p1" })
      const ready = await hostChatView(ctx.db, "u", "en")
      expect(texts(ready).slice(-2)).toEqual(["Work: No fixed hours\nOpen for meetings: Mon·Tue·Wed 13:00–18:00\nMeeting mode: Online (if possible)", "Confirm these settings?"])
      expect(ready.replies.map((r) => r.id)).toEqual(["confirm", "adjust"])

      expect(texts(await hostChatSend(ctx, "u", { revision: ready.revision, reply: "adjust", locale: "en" }, { key: "a1" })).at(-1)).toBe("Type what to change and send it.")

      const confirm = { revision: ready.revision, reply: "confirm", locale: "en" as const }
      const done = hostChatViewSchema.parse(await hostChatSend(ctx, "u", confirm, { key: "c1" }))
      expect(done.messages.find((m) => m.card)?.card).toMatchObject({ kind: "link", path: expect.stringMatching(/^\/invite\/[A-Za-z0-9_-]{24}$/) })
      expect(texts(done)).toContain("Saved.")
      // no place or meeting type yet, so the next step is host settings
      expect(done.replies).toEqual([{ id: "host", label: "Open host settings", href: "/settings/host" }])
      expect(done.revision).toBeNull()
      await hostChatSend(ctx, "u", confirm, { key: "c1" })
      expect((await sqlite.prepare("SELECT count(*) n FROM profile_versions WHERE user_id='u'").get())).toEqual({ n: 1 })
    } finally { sqlite.close() }
  })

  it("refuses a reply it did not offer", async () => {
    const { ctx, sqlite } = await host(); try {
      await expect(hostChatSend(ctx, "u", { revision: null, reply: "teleport", locale: "en" }, { key: "x" })).rejects.toMatchObject({ code: "invalid_input" })
      await expect(hostChatSend(ctx, "u", { revision: null, reply: "confirm", locale: "en" }, { key: "y" })).rejects.toMatchObject({ code: "invalid_input" })
    } finally { sqlite.close() }
  })
})

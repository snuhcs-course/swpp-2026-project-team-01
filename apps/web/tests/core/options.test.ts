import { expect, it } from "vitest"
import { decideOptions, pickDiverse } from "@/core/options"
import { rankForParticipants } from "@/core/filter"
import { ONLINE, PLACES, T, T30 } from "./helpers"
const host = { weekdays: null, startTime: null, meetingMode: null, slack: null }
const slots = [0, 1, 2, 3].map(i => ({ startMs: T("2026-10-05", "10:00"), endMs: T("2026-10-05", "10:30"), placeId: ONLINE.id, meetingTypeId: `${T30.id}-${i}`, slackMin: 60 }))
it("does not settle third/fourth ties by type ID even with explicit order", () => {
  const ranked = rankForParticipants(slots, { order: "latest" }, host, PLACES)
  expect(decideOptions(ranked, { order: "latest" }, false).show).toBe(false)
  expect(decideOptions(ranked, {}, false, true)).toMatchObject({ show: true, reason: "initial" })
})
it("settles a boundary only on client, host, or explicit time keys", () => {
  const times = slots.map((s, i) => ({ ...s, startMs: s.startMs + i * 3_600_000, endMs: s.endMs + i * 3_600_000 }))
  expect(decideOptions(rankForParticipants(times, {}, host, PLACES), {}, false).show).toBe(false)
  expect(decideOptions(rankForParticipants(times, { order: "earliest" }, host, PLACES), { order: "earliest" }, false).show).toBe(true)
})
it("caps options at three even if a caller asks for more", () => {
  expect(pickDiverse(rankForParticipants(slots, {}, host, PLACES), 10)).toHaveLength(3)
  expect(pickDiverse(rankForParticipants(slots, {}, host, PLACES), 0)).toEqual([])
})

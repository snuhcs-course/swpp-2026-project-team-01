// AI-generated with Claude Code (claude-sonnet-5-5), 2026-09-29
import { describe, expect, it } from "vitest"
import { autoDeclineIds, groupOverlapping, isExpired, overlapsOwnPending } from "@/core/booking"
import type { RequestLike } from "@/core/types"
import { T } from "./helpers"

const req = (id: string, from: string, to: string, status: RequestLike["status"] = "pending"): RequestLike => ({
  id,
  startMs: T("2026-10-07", from),
  endMs: T("2026-10-07", to),
  status,
})
const NOW = T("2026-10-05", "09:00")

describe("overlapsOwnPending", () => {
  const own = [req("a", "14:00", "15:00")]
  it("blocks overlapping pending requests", () => {
    expect(overlapsOwnPending(own, req("n", "14:30", "15:30"), NOW)).toBe(true)
  })
  it("allows touching intervals", () => {
    expect(overlapsOwnPending(own, req("n", "15:00", "16:00"), NOW)).toBe(false)
    expect(overlapsOwnPending(own, req("n", "13:00", "14:00"), NOW)).toBe(false)
  })
  it("ignores declined, withdrawn, accepted, and expired requests", () => {
    for (const status of ["declined", "withdrawn", "accepted"] as const) {
      expect(overlapsOwnPending([req("a", "14:00", "15:00", status)], req("n", "14:00", "15:00"), NOW)).toBe(false)
    }
    expect(overlapsOwnPending(own, req("n", "14:00", "15:00"), T("2026-10-07", "14:30"))).toBe(false)
  })
})

describe("expiry and grouping", () => {
  it("a pending request is expired once its start has passed", () => {
    expect(isExpired(req("a", "14:00", "15:00"), T("2026-10-07", "14:00"))).toBe(false)
    expect(isExpired(req("a", "14:00", "15:00"), T("2026-10-07", "14:01"))).toBe(true)
    expect(isExpired(req("a", "14:00", "15:00", "accepted"), T("2026-10-08", "09:00"))).toBe(false)
  })
  it("auto-declines only overlapping pending requests other than the accepted one", () => {
    const accepted = req("a", "14:00", "15:00")
    const others = [accepted, req("b", "14:30", "15:30"), req("c", "15:00", "16:00"), req("d", "13:00", "14:30"), req("e", "14:00", "15:00", "declined")]
    expect(autoDeclineIds(accepted, others).sort()).toEqual(["b", "d"])
  })
  it("groups transitively overlapping requests", () => {
    const groups = groupOverlapping([req("c", "16:00", "17:00"), req("b", "14:30", "15:30"), req("a", "14:00", "15:00"), req("d", "15:15", "16:00")])
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([["a", "b", "d"], ["c"]])
  })
})

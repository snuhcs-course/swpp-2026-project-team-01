import { describe, expect, it } from "vitest"
import { computeSlots } from "@/core/slots"
import { kstDateString, kstTimeString } from "@/core/time"
import type { Person } from "@/core/types"
import { NEAR, ONLINE, PLACES, SPECIAL, T, T30, T60, ev, person, startsOf } from "./helpers"

// 2026-10-05 is a Monday. `now` = midnight so the minimum lead time never hides a slot.
const NOW = T("2026-10-05", "00:00")
const D = "2026-10-05"

function slots(host: Person, client: Person, nowMs = NOW) {
  return computeSlots({ host, client, places: PLACES, meetingTypes: [T30, T60], nowMs })
}

describe("computeSlots — window, horizon, lead time", () => {
  const all = slots(person(), person())

  it("stays inside 08:00–22:00", () => {
    const online30 = startsOf(all, D, ONLINE.id, T30.id)
    expect(online30[0]).toBe("08:00")
    expect(online30[online30.length - 1]).toBe("21:30")
    const online60 = startsOf(all, D, ONLINE.id, T60.id)
    expect(online60[online60.length - 1]).toBe("21:00")
  })

  it("adds no travel time at the edge of the window", () => {
    expect(startsOf(all, D, SPECIAL.id, T30.id)[0]).toBe("08:00")
  })

  it("covers 60 calendar days starting today", () => {
    const dates = new Set(all.map((s) => kstDateString(s.startMs)))
    expect(dates.has("2026-10-05")).toBe(true)
    expect(dates.has("2026-12-03")).toBe(true)
    expect(dates.has("2026-12-04")).toBe(false)
  })

  it("drops slots starting within 2 hours of now", () => {
    const now = T(D, "09:00")
    const first = slots(person(), person(), now)[0]
    expect(kstTimeString(first.startMs)).toBe("11:00")
  })

  it("returns nothing without places or meeting types", () => {
    expect(computeSlots({ host: person(), client: person(), places: [], meetingTypes: [T30], nowMs: NOW })).toEqual([])
    expect(computeSlots({ host: person(), client: person(), places: PLACES, meetingTypes: [], nowMs: NOW })).toEqual([])
  })

  it("respects a disabled weekday and a custom window", () => {
    const host = person()
    host.rules[1] = { ...host.rules[1], enabled: false } // Monday
    host.rules[2] = { ...host.rules[2], startMin: 10 * 60, endMin: 12 * 60 } // Tuesday
    const s = slots(host, person())
    expect(startsOf(s, D, ONLINE.id, T30.id)).toEqual([])
    expect(startsOf(s, "2026-10-06", ONLINE.id, T30.id)).toEqual(["10:00", "10:30", "11:00", "11:30"])
  })
})

describe("computeSlots — overlap", () => {
  it("blocks slots overlapping either person's event, online included", () => {
    const s = slots(person([ev(D, "14:00", "15:00", "online")]), person([ev(D, "10:00", "11:00", "online")]))
    const online60 = startsOf(s, D, ONLINE.id, T60.id)
    expect(online60).not.toContain("13:30")
    expect(online60).not.toContain("14:30")
    expect(online60).toContain("13:00")
    expect(online60).toContain("15:00")
    expect(online60).not.toContain("09:30")
    expect(online60).toContain("11:00")
  })
})

describe("computeSlots — travel time, host", () => {
  it("after an office event: near 30 min, special 60 min, online 0", () => {
    const s = slots(person([ev(D, "10:00", "12:00", "office")]), person())
    expect(startsOf(s, D, NEAR.id, T30.id)).toContain("12:30")
    expect(startsOf(s, D, NEAR.id, T30.id)).not.toContain("12:00")
    expect(startsOf(s, D, SPECIAL.id, T30.id)).toContain("13:00")
    expect(startsOf(s, D, SPECIAL.id, T30.id)).not.toContain("12:30")
    expect(startsOf(s, D, ONLINE.id, T30.id)).toContain("12:00")
  })

  it("before an office event, the same table applies in reverse", () => {
    const s = slots(person([ev(D, "16:00", "17:00", "office")]), person())
    expect(startsOf(s, D, NEAR.id, T30.id)).toContain("15:00")
    expect(startsOf(s, D, NEAR.id, T30.id)).not.toContain("15:30")
    expect(startsOf(s, D, SPECIAL.id, T30.id)).toContain("14:30")
    expect(startsOf(s, D, SPECIAL.id, T30.id)).not.toContain("15:00")
    expect(startsOf(s, D, ONLINE.id, T30.id)).toContain("15:30")
  })

  it("after another place: near 60 min, special 30 min", () => {
    const s = slots(person([ev(D, "10:00", "12:00", "place", "다른 곳")]), person())
    expect(startsOf(s, D, NEAR.id, T30.id)).toContain("13:00")
    expect(startsOf(s, D, NEAR.id, T30.id)).not.toContain("12:30")
    expect(startsOf(s, D, SPECIAL.id, T30.id)).toContain("12:30")
    expect(startsOf(s, D, SPECIAL.id, T30.id)).not.toContain("12:00")
  })

  it("same place needs no travel", () => {
    const s = slots(person([ev(D, "10:00", "12:00", "place", SPECIAL.name)]), person())
    expect(startsOf(s, D, SPECIAL.id, T30.id)).toContain("12:00")
  })

  it("an online event is not an origin: travel is measured from the last offline event", () => {
    // office until 12:50, online 12:50–13:00, then a meeting at the special place.
    const host = person([ev(D, "10:00", "12:50", "office"), ev(D, "12:50", "13:00", "online")])
    const s = slots(host, person())
    const special = startsOf(s, D, SPECIAL.id, T30.id)
    expect(special).not.toContain("13:00")
    expect(special).not.toContain("13:30")
    expect(special).toContain("14:00")
  })

  it("the online-event rule also applies after the meeting", () => {
    const host = person([ev(D, "15:10", "15:30", "online"), ev(D, "15:30", "17:00", "office")])
    const s = slots(host, person())
    const special = startsOf(s, D, SPECIAL.id, T30.id)
    expect(special).toContain("14:00") // ends 14:30, office at 15:30: exactly 60 min
    expect(special).not.toContain("14:30")
  })
})

describe("computeSlots — travel time, client", () => {
  it("any offline meeting needs 1 hour, online none", () => {
    const s = slots(person(), person([ev(D, "10:00", "12:00", "office")]))
    expect(startsOf(s, D, NEAR.id, T30.id)).toContain("13:00")
    expect(startsOf(s, D, NEAR.id, T30.id)).not.toContain("12:30")
    expect(startsOf(s, D, SPECIAL.id, T30.id)).toContain("13:00")
    expect(startsOf(s, D, ONLINE.id, T30.id)).toContain("12:00")
  })
})

describe("computeSlots — slack and performance", () => {
  it("reports spare minutes to the nearest neighbour", () => {
    const s = slots(person([ev(D, "12:00", "13:00", "online")]), person())
    const slot = s.find((x) => x.placeId === ONLINE.id && x.meetingTypeId === T30.id && kstTimeString(x.startMs) === "10:30" && kstDateString(x.startMs) === D)
    expect(slot?.slackMin).toBe(60)
  })

  it("handles 2 people × 60 days × 3 places × 3 types under 1 second", () => {
    const events = []
    for (let d = 0; d < 60; d++) {
      const date = kstDateString(NOW + d * 86_400_000)
      events.push(ev(date, "09:00", "10:00", "office"), ev(date, "12:00", "13:00", "place", "식당"), ev(date, "15:00", "16:30", "office"), ev(date, "19:00", "20:00", "online"))
    }
    const t = { id: "t90", name: "90분", durationMin: 90 }
    const start = performance.now()
    const s = computeSlots({ host: person(events), client: person(events), places: PLACES, meetingTypes: [T30, T60, t], nowMs: NOW })
    const elapsed = performance.now() - start
    expect(s.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1000)
  })
})

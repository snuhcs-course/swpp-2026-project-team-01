import { describe, expect, it } from "vitest"
import { travelMinutes } from "@/core/travel"
import type { CalEvent } from "@/core/types"
import { NEAR, ONLINE, SPECIAL } from "./helpers"

const at = (kind: CalEvent["kind"], placeRef: string | null = null): CalEvent => ({
  id: "x",
  title: "x",
  startMs: 0,
  endMs: 1,
  kind,
  placeRef,
})

describe("travelMinutes — host table", () => {
  it("from the office", () => {
    expect(travelMinutes(at("office"), NEAR, "host")).toBe(30)
    expect(travelMinutes(at("office"), SPECIAL, "host")).toBe(60)
    expect(travelMinutes(at("office"), ONLINE, "host")).toBe(0)
  })
  it("from a place other than the office", () => {
    expect(travelMinutes(at("place", "다른 곳"), NEAR, "host")).toBe(60)
    expect(travelMinutes(at("place", "다른 곳"), SPECIAL, "host")).toBe(30)
    expect(travelMinutes(at("place", "다른 곳"), ONLINE, "host")).toBe(0)
  })
  it("an event with no location counts as a place other than the office", () => {
    expect(travelMinutes(at("none"), NEAR, "host")).toBe(60)
    expect(travelMinutes(at("none"), SPECIAL, "host")).toBe(30)
    expect(travelMinutes(at("none"), ONLINE, "host")).toBe(0)
  })
  it("same place is 0, matched by id or by name", () => {
    expect(travelMinutes(at("place", NEAR.id), NEAR, "host")).toBe(0)
    expect(travelMinutes(at("place", SPECIAL.name), SPECIAL, "host")).toBe(0)
  })
  it("a place event that merely shares the kind is not the same place", () => {
    expect(travelMinutes(at("place", NEAR.id), SPECIAL, "host")).toBe(30)
    expect(travelMinutes(at("place", SPECIAL.id), NEAR, "host")).toBe(60)
  })
})

describe("travelMinutes — client", () => {
  it("any offline meeting is 1 hour, whatever the origin", () => {
    for (const kind of ["office", "place", "none"] as const) {
      expect(travelMinutes(at(kind, "x"), NEAR, "client")).toBe(60)
      expect(travelMinutes(at(kind, "x"), SPECIAL, "client")).toBe(60)
    }
  })
  it("online meetings need no travel", () => {
    expect(travelMinutes(at("office"), ONLINE, "client")).toBe(0)
  })
  it("same place is 0", () => {
    expect(travelMinutes(at("place", SPECIAL.name), SPECIAL, "client")).toBe(0)
  })
})

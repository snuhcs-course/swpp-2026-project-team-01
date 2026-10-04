import { describe, expect, it } from "vitest"
import { profileValuesSchema, patchDraftSchema, confirmProfileSchema } from "@/contracts/profile"
import { selectionSchema, annotationSchema } from "@/contracts/calendar"
import { authStartSchema } from "@/contracts/auth"
import { conditionsSchema } from "@/contracts/search"
import { createRequestSchema } from "@/contracts/booking"
import { operationMetaSchema } from "@/contracts/operations"

const empty = { work: { mode: "none", windows: [] }, meetingWindows: [], preferences: { weekdays: null, startTime: null, meetingMode: null, slack: null } }

describe("public command boundaries", () => {
  it("accepts explicitly empty profile without inventing defaults", () => {
    expect(profileValuesSchema.parse(empty)).toEqual(empty)
  })
  it("rejects unsupported global preferences and fractional minutes", () => {
    expect(profileValuesSchema.safeParse({ ...empty, preferences: { ...empty.preferences, placeIds: ["p"] } }).success).toBe(false)
    expect(profileValuesSchema.safeParse({ ...empty, meetingWindows: [{ weekday: 2, startMin: 600.5, endMin: 720 }] }).success).toBe(false)
  })
  it("allows incomplete drafts but requires a version for confirmation", () => {
    expect(patchDraftSchema.safeParse({ expectedRevision: 0, patch: { meetingWindows: [] } }).success).toBe(true)
    expect(confirmProfileSchema.safeParse({ expectedRevision: 0 }).success).toBe(false)
    expect(confirmProfileSchema.parse({ expectedRevision: 0, baseProfileVersion: null })).toEqual({ expectedRevision: 0, baseProfileVersion: null })
  })
  it("rejects injected ownership and invalid revisions", () => {
    expect(patchDraftSchema.safeParse({ expectedRevision: 1, patch: {}, userId: "victim" }).success).toBe(false)
    expect(patchDraftSchema.safeParse({ expectedRevision: -1, patch: {} }).success).toBe(false)
  })
  it("requires unique calendar selection and source fingerprint for annotations", () => {
    expect(selectionSchema.safeParse({ expectedSelectionRevision: 0, calendarIds: ["a", "a"] }).success).toBe(false)
    expect(annotationSchema.safeParse({ expectedRevision: 0, patch: { locationKind: "online" } }).success).toBe(false)
  })
  it("only accepts safe relative auth returns", () => {
    expect(authStartSchema.safeParse({ purpose: "login", returnPath: "https://evil.test" }).success).toBe(false)
    expect(authStartSchema.safeParse({ purpose: "login", returnPath: "//evil.test" }).success).toBe(false)
    expect(authStartSchema.safeParse({ purpose: "login", returnPath: "/\\evil.test" }).success).toBe(false)
    expect(authStartSchema.safeParse({ purpose: "calendar", returnPath: "/settings/calendars" }).success).toBe(true)
  })
  it("keeps disabling inherited conditions explicit", () => {
    const input = { expectedRevision: 2, commands: [{ kind: "disable", dimension: "weekdays" }] }
    expect(conditionsSchema.parse(input)).toEqual(input)
    expect(conditionsSchema.safeParse({ ...input, commands: [{ kind: "set", dimension: "weekdays", value: { days: [8], strength: "must" } }] }).success).toBe(false)
  })
  it("requires original slot end and rejects inverted intervals", () => {
    const input = { searchId: "s", expectedSearchRevision: 0, slot: { startAt: 1000, endAt: 2000, placeId: "p", meetingTypeId: "t" }, message: "hello" }
    expect(createRequestSchema.safeParse(input).success).toBe(true)
    expect(createRequestSchema.safeParse({ ...input, slot: { ...input.slot, endAt: 1000 } }).success).toBe(false)
    const { endAt: _, ...withoutEnd } = input.slot
    expect(createRequestSchema.safeParse({ ...input, slot: withoutEnd }).success).toBe(false)
  })
  it("requires nonempty bounded operation keys", () => {
    expect(operationMetaSchema.safeParse({ key: "" }).success).toBe(false)
    expect(operationMetaSchema.safeParse({ key: "x".repeat(201) }).success).toBe(false)
    expect(operationMetaSchema.safeParse({ key: "op-example" }).success).toBe(true)
  })
})

import { syncSchema, disconnectSchema } from '@/contracts/calendar'
describe('calendar sync input', () => {
  it('accepts an optional refresh scope, rejects unknown ones, and keeps disconnect scope-free', () => {
    expect(syncSchema.safeParse({ expectedSelectionRevision: 1 }).success).toBe(true)
    expect(syncSchema.safeParse({ expectedSelectionRevision: 1, scope: 'future' }).success).toBe(true)
    expect(syncSchema.safeParse({ expectedSelectionRevision: 1, scope: 'weekly' }).success).toBe(false)
    expect(disconnectSchema.safeParse({ expectedSelectionRevision: 1, scope: 'future' }).success).toBe(false)
  })
})

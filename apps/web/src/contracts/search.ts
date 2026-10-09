// AI-generated with Codex (gpt-6-astra), 2026-10-04, 2026-10-05
import { z } from "zod"
import { idSchema, revisionSchema, textSchema } from "./common"
import { daysSchema, preferencesSchema, strengthSchema } from "./profile"
import { slotSchema } from "./booking"
const strength = z.enum(["must", "strong", "weak"])
const hm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const time = z.strictObject({ start: hm, end: z.union([hm, z.literal("24:00")]), strength }).refine(v => v.start < v.end)
const day = z.iso.date()
export const filterSchema = z.strictObject({
  weekdays: z.strictObject({ days: daysSchema, strength }).optional(), timeOfDay: time.optional(),
  places: z.strictObject({ placeIds: z.array(idSchema).min(1), strength }).optional(),
  meetingMode: z.strictObject({ value: z.enum(["online", "offline"]), strength }).optional(),
  meetingTypes: z.strictObject({ ids: z.array(idSchema).min(1), strength }).optional(),
  dateRange: z.strictObject({ from: day, to: day, strength }).refine(v => v.from <= v.to).optional(),
  order: z.enum(["earliest", "latest"]).optional(), slack: z.strictObject({ strength: strengthSchema }).optional(),
})
const dimension = z.enum(["weekdays", "timeOfDay", "location", "meetingTypes", "dateRange", "order", "slack"])
const setCommands = [
  z.strictObject({ kind: z.literal("set"), dimension: z.literal("weekdays"), value: filterSchema.shape.weekdays.unwrap() }),
  z.strictObject({ kind: z.literal("set"), dimension: z.literal("timeOfDay"), value: time }),
  z.strictObject({ kind: z.literal("set"), dimension: z.literal("location"), value: z.union([filterSchema.shape.places.unwrap(), filterSchema.shape.meetingMode.unwrap()]) }),
  z.strictObject({ kind: z.literal("set"), dimension: z.literal("meetingTypes"), value: filterSchema.shape.meetingTypes.unwrap() }),
  z.strictObject({ kind: z.literal("set"), dimension: z.literal("dateRange"), value: filterSchema.shape.dateRange.unwrap() }),
  z.strictObject({ kind: z.literal("set"), dimension: z.literal("order"), value: filterSchema.shape.order.unwrap() }),
  z.strictObject({ kind: z.literal("set"), dimension: z.literal("slack"), value: filterSchema.shape.slack.unwrap() }),
] as const
export const conditionCommandSchema = z.union([
  ...setCommands, z.strictObject({ kind: z.literal("disable"), dimension }),
  z.strictObject({ kind: z.literal("restore_inherited"), dimension }), z.strictObject({ kind: z.literal("apply_latest_defaults") }),
])
export const conditionsSchema = z.strictObject({ expectedRevision: revisionSchema, commands: z.array(conditionCommandSchema).min(1).max(20) })
export const createSearchSchema = z.strictObject({ hostId: idSchema, meetingTypeId: idSchema.optional() })
export const refreshSearchSchema = z.strictObject({ expectedRevision: revisionSchema })
export const searchTurnSchema = refreshSearchSchema.extend({ text: textSchema })
export const bookingSearchViewSchema = z.strictObject({ searchId: idSchema, hostId: idSchema, revision: revisionSchema, inheritedProfileVersion: revisionSchema.nullable(), inheritedPreferences: preferencesSchema, effectiveConditions: filterSchema, candidateState: z.enum(["not_ready", "ready", "stale", "unavailable"]), candidates: z.array(slotSchema), count: z.number().int().nonnegative().nullable() })
export type CreateSearchInput = z.infer<typeof createSearchSchema>
export type RefreshSearchInput = z.infer<typeof refreshSearchSchema> & { searchId: string }
export type ChangeConditionsInput = z.infer<typeof conditionsSchema> & { searchId: string }
export type SearchTurnInput = z.infer<typeof searchTurnSchema> & { searchId: string }
export type BookingSearchView = z.infer<typeof bookingSearchViewSchema>

export const searchScreenViewSchema=bookingSearchViewSchema.extend({
 labels:z.array(z.string()),chips:z.array(z.object({key:z.string(),label:z.string(),text:z.string(),strength:z.string().nullable()})),
 sources:z.record(z.string(),z.enum(['inherit','override','disabled'])),overrides:z.record(z.string(),z.unknown()),
 messages:z.array(z.object({id:z.string(),role:z.enum(['user','assistant']),content:z.string()})),basis:z.unknown().nullable(),
})
export type SearchScreenView=z.infer<typeof searchScreenViewSchema>

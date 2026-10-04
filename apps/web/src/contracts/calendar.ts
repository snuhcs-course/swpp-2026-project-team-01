import { z } from "zod"
import { idSchema, revisionSchema, instantSchema } from "./common"
export const selectionSchema = z.strictObject({ expectedSelectionRevision: revisionSchema, calendarIds: z.array(idSchema).max(100).refine(ids => new Set(ids).size === ids.length, "캘린더가 중복됐어요") })
/** `scope` picks what to refresh: `future` only the coming 60 days (enough for My Calendar), `full` also the 8-week history used for analysis. */
export const syncSchema = z.strictObject({ expectedSelectionRevision: revisionSchema, scope: z.enum(["full", "future"]).optional() })
export const disconnectSchema = z.strictObject({ expectedSelectionRevision: revisionSchema })
export const useDecisionSchema = z.strictObject({ expectedRevision: revisionSchema, choice: z.literal("continue_without_calendar") })
export const annotationSchema = z.strictObject({ expectedRevision: revisionSchema, sourceFingerprint: z.string().min(1).max(256), patch: z.strictObject({
  locationKind: z.enum(["office", "place", "online", "none"]).optional(), placeRef: z.string().max(512).nullable().optional(),
  classification: z.enum(["business", "personal", "unknown"]).optional(), businessMeeting: z.boolean().optional(),
}) })
export const calendarUseStateSchema = z.enum(["manual", "connected", "needs_refresh", "reconnect_required", "decision_required"])
export const syncViewSchema = z.strictObject({ snapshotId: idSchema, generation: revisionSchema, selectionRevision: revisionSchema, scope: z.enum(["full", "future"]), fromMs: instantSchema, toMs: instantSchema, startedAt: instantSchema, completedAt: instantSchema })
export const calendarConnectionViewSchema = z.strictObject({ status: calendarUseStateSchema, revision: revisionSchema, selectionRevision: revisionSchema, sources: z.array(z.strictObject({ id: idSchema, name: z.string(), selected: z.boolean(), timeZone: z.string(), access: z.enum(["detail", "busy"]) })), analysis: syncViewSchema.nullable(), schedule: syncViewSchema.nullable(), lastError: z.string().nullable() })
export const aiClassificationSchema = z.enum(["business", "personal", "unknown"])
/** Owner-only list view of one imported event. `classification` is the user's confirmed value; `aiClassification` is only a suggestion. */
export const importedEventViewSchema = z.strictObject({
  eventId: idSchema, title: z.string(), startAt: instantSchema, endAt: instantSchema,
  allDay: z.boolean(), startDate: z.string().nullable(), endDate: z.string().nullable(), timezone: z.string().nullable(),
  revision: revisionSchema, sourceFingerprint: z.string(), patch: z.record(z.string(), z.unknown()), needsConfirmation: z.boolean(),
  locationKind: z.string(), classification: z.string(), aiClassification: aiClassificationSchema.nullable(),
})
export type ImportedEventView = z.infer<typeof importedEventViewSchema>
/** What Google provided about one event (read-only), next to the user's own supplement carried by the base view. */
export const importedEventDetailSchema = importedEventViewSchema.extend({
  detail: z.strictObject({
    calendarName: z.string(), status: z.enum(["confirmed", "tentative"]), busy: z.boolean(),
    providedLocation: z.string().nullable(), providedKind: z.enum(["office", "place", "online", "none"]).nullable(), onlineLink: z.boolean(),
  }),
})
export type ImportedEventDetail = z.infer<typeof importedEventDetailSchema>
export type SyncInput = z.infer<typeof syncSchema>
export type DisconnectInput = z.infer<typeof disconnectSchema>
export type SaveAnnotationInput = z.infer<typeof annotationSchema> & { eventId: string }
export type SyncView = z.infer<typeof syncViewSchema>
export type CalendarConnectionView = z.infer<typeof calendarConnectionViewSchema>
export type EventAnnotationView = { eventId: string; revision: number; sourceFingerprint: string; patch: z.infer<typeof annotationSchema>["patch"]; needsConfirmation: boolean }

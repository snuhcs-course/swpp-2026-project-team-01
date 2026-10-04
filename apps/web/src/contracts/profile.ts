import { z } from "zod"
import { idSchema, revisionSchema, textSchema, instantSchema } from "./common"

export const weekdaySchema = z.number().int().min(0).max(6)
export const strengthSchema = z.enum(["strong", "weak"])
export const timeWindowSchema = z.strictObject({ startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440) })
  .refine(w => w.startMin < w.endMin, { message: "시작보다 종료가 늦어야 해요", path: ["endMin"] })
export const weeklyWindowSchema = z.strictObject({ weekday: weekdaySchema, startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440) })
  .refine(w => w.startMin < w.endMin, { message: "자정을 넘는 구간은 요일별로 나눠 주세요", path: ["endMin"] })
export const windowsSchema = z.array(weeklyWindowSchema).max(128)
export const daysSchema = z.array(weekdaySchema).min(1).max(7).refine(days => new Set(days).size === days.length, "요일이 중복됐어요")
export const preferencesSchema = z.strictObject({
  weekdays: z.strictObject({ value: daysSchema, strength: strengthSchema }).nullable(),
  startTime: z.strictObject({ value: timeWindowSchema, strength: strengthSchema }).nullable(),
  meetingMode: z.strictObject({ value: z.enum(["online", "offline"]), strength: strengthSchema }).nullable(),
  slack: z.strictObject({ strength: strengthSchema }).nullable(),
})
export const workSchema = z.strictObject({ mode: z.enum(["fixed", "none"]), windows: windowsSchema }).refine(
  w => w.mode === "none" ? w.windows.length === 0 : w.windows.length > 0, "고정 근무 없음과 시간 구간이 일치하지 않아요")
export const profileValuesSchema = z.strictObject({ work: workSchema, meetingWindows: windowsSchema, preferences: preferencesSchema })
export const topicsSchema = z.strictObject({ work: z.enum(["unanswered", "confirmed"]), meetingWindows: z.enum(["unanswered", "confirmed"]), preferences: z.enum(["unanswered", "confirmed"]) })
export const createDraftSchema = z.strictObject({ purpose: z.enum(["onboarding", "edit"]) })
export const patchDraftSchema = z.strictObject({
  expectedRevision: revisionSchema,
  patch: profileValuesSchema.partial(),
  topicConfirmations: topicsSchema.partial().optional(),
  proposalId: idSchema.optional(), sourceRevision: revisionSchema.optional(),
})
export const confirmProfileSchema = z.strictObject({ expectedRevision: revisionSchema, baseProfileVersion: revisionSchema.nullable() })
export const onboardingTurnSchema = z.strictObject({ expectedRevision: revisionSchema, text: textSchema })
export const analyzeDraftSchema = z.strictObject({ expectedRevision: revisionSchema })
export const profileViewSchema = z.strictObject({ version: revisionSchema, values: profileValuesSchema, confirmedAt: instantSchema.nullable(), origin: z.enum(["legacy", "user"]) })
export const draftMessageSchema = z.strictObject({ id: idSchema, role: z.enum(["user", "assistant"]), content: z.string(), createdAt: instantSchema, evidenceIds: z.array(idSchema).optional(), interpretFailed: z.boolean().optional() })
export const profileDraftViewSchema = z.strictObject({
  draftId: idSchema, revision: revisionSchema, baseProfileVersion: revisionSchema.nullable(), values: profileValuesSchema,
  topics: topicsSchema, status: z.enum(["active", "confirmed"]), updatedAt: instantSchema, messages: z.array(draftMessageSchema),
  fieldErrors: z.record(z.string(), z.array(z.string())),
})
export type CreateDraftInput = z.infer<typeof createDraftSchema>
export type PatchDraftInput = z.infer<typeof patchDraftSchema> & { draftId: string }
export type ConfirmProfileInput = z.infer<typeof confirmProfileSchema> & { draftId: string }
export type OnboardingTurnInput = z.infer<typeof onboardingTurnSchema> & { draftId: string }
export type AnalyzeDraftInput = z.infer<typeof analyzeDraftSchema> & { draftId: string }
export type ProfileView = z.infer<typeof profileViewSchema>
export type ProfileDraftView = z.infer<typeof profileDraftViewSchema>
export type DraftTopics = z.infer<typeof topicsSchema>

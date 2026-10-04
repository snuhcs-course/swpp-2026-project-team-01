import { z } from "zod"
import { idSchema, revisionSchema, instantSchema } from "./common"
export const slotSchema = z.strictObject({ startAt: instantSchema, endAt: instantSchema, placeId: idSchema, meetingTypeId: idSchema }).refine(s => s.endAt > s.startAt, { message: "종료 시각이 시작보다 늦어야 해요", path: ["endAt"] })
export const createRequestSchema = z.strictObject({ searchId: idSchema, expectedSearchRevision: revisionSchema, slot: slotSchema, message: z.string().trim().min(1).max(500) })
export const requestDecisionSchema = z.strictObject({ expectedRevision: revisionSchema })
export const acceptRequestSchema = requestDecisionSchema.extend({ impactToken: z.string().min(1).max(4096) })
export const requestViewSchema = z.strictObject({ id: idSchema, revision: revisionSchema, clientId: idSchema, hostId: idSchema, startAt: instantSchema, endAt: instantSchema, placeId: idSchema, meetingTypeId: idSchema, message: z.string(), status: z.enum(["pending", "accepted", "declined", "withdrawn"]), expired: z.boolean(), conflict: z.boolean() })
export type CreateRequestInput = z.infer<typeof createRequestSchema>
export type AcceptRequestInput = z.infer<typeof acceptRequestSchema> & { requestId: string }
export type RequestView = z.infer<typeof requestViewSchema>
export type AcceptPreview = { requestId: string; revision: number; affectedIds: string[]; impactToken: string }
export type AcceptResult = { request: RequestView; declinedIds: string[]; eventIds: string[] }

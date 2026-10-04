import { z } from "zod"
import { idSchema, revisionSchema } from "./common"
export const operationMetaSchema = z.strictObject({ key: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/) })
export const operationStateSchema = z.enum(["running", "succeeded", "failed_retryable", "failed_final", "interrupted"])
export const operationViewSchema = z.strictObject({ id: idSchema, kind: idSchema, state: operationStateSchema, attempt: revisionSchema, resourceId: idSchema.nullable(), errorCode: z.string().nullable(), result: z.unknown().optional() })
export type OperationView = z.infer<typeof operationViewSchema>
export type { OperationMeta } from "./common"

import { z } from "zod"

export const idSchema = z.string().trim().min(1).max(512)
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const instantSchema = z.number().int().nonnegative().max(8_640_000_000_000_000)
export const textSchema = z.string().trim().min(1).max(4000)
export const errorCodeSchema = z.enum([
  "invalid_input", "unsupported_condition", "preference_conflict", "unauthenticated", "forbidden", "csrf_failed", "not_found",
  "revision_conflict", "profile_version_conflict", "source_changed", "idempotency_key_reused", "operation_pending", "operation_lease_lost",
  "setup_required", "calendar_decision_required", "calendar_reconnect_required", "slot_unavailable", "overlapping_request",
  "request_not_pending", "request_expired", "meeting_definition_changed", "accept_impact_changed", "calendar_snapshot_changed",
  "calendar_busy", "database_busy", "calendar_fetch_failed", "calendar_limit_exceeded", "operation_timeout", "internal_error", "account_mismatch",
])
export type ErrorCode = z.infer<typeof errorCodeSchema>
export type FieldErrors = Record<string, string[]>
export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false,
    public readonly fieldErrors?: FieldErrors, public readonly currentRevision?: number) { super(message); this.name = "DomainError" }
}
export type OperationMeta = { key: string }
export type ApiResult<T> =
  | { ok: true; data: T; meta: { operationId?: string; revision?: number } }
  | { ok: false; error: { code: ErrorCode; message: string; retryable: boolean; fieldErrors?: FieldErrors; currentRevision?: number }; meta: { operationId?: string; outcome: "not_applied" | "pending" | "unknown" } }
export const outcomeSchema = z.enum(["not_applied", "pending", "unknown"])

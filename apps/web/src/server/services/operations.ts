import { createHash } from "node:crypto"
import { DomainError, type OperationMeta } from "@/contracts/common"
import { operationMetaSchema, type OperationView } from "@/contracts/operations"
import { lock, one, run, type Db } from "../db/client"
import type { ServiceContext } from "../runtime"

interface StoredOperation {
 id: string; owner_id: string; kind: string; key: string; payload_hash: string;
 state: "running" | "succeeded" | "failed_retryable" | "failed_final";
 attempt: number; fence: number; lease_until: number; result_json: string | null; error_json: string | null;
 reserved_resource_id: string | null; phase: string | null;
}
export interface OperationClaim { id: string; ownerId: string; fence: number; leaseUntil: number; attempt: number; startedAt: number; replay: boolean; result?: unknown; resourceId: string | null; phase: string | null }
function canonical(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
 if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v !== undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")}}`
 return JSON.stringify(value) ?? "null"
}
export async function beginOperation(ctx: ServiceContext, actorId: string, kind: string, input: unknown, op: OperationMeta): Promise<OperationClaim> {
 operationMetaSchema.parse(op)
 const now = ctx.clock.now(), hash = createHash("sha256").update(canonical(input)).digest("hex")
 return ctx.db.transaction(async (tx) => {
  if (!(await one(tx, "SELECT id FROM users WHERE id=?", [actorId]))) throw new DomainError("unauthenticated", "로그인이 필요해요")
  // Concurrent attempts with the same key queue here, so exactly one of them inserts or reclaims the operation.
  await lock(tx, `operation:${actorId}:${kind}:${op.key}`)
  const old = await one<StoredOperation>(tx, "SELECT * FROM mutation_operations WHERE owner_id=? AND kind=? AND key=?", [actorId, kind, op.key])
  if (old) {
   if (old.payload_hash !== hash) throw new DomainError("idempotency_key_reused", "다른 입력에 같은 작업 키를 사용할 수 없어요")
   if (old.state === "succeeded") return {id:old.id,ownerId:actorId,fence:old.fence,leaseUntil:old.lease_until,attempt:old.attempt,startedAt:now,replay:true,result:JSON.parse(old.result_json ?? "null"),resourceId:old.reserved_resource_id,phase:old.phase}
   if (old.state === "failed_final") { const error = JSON.parse(old.error_json ?? "{}"); throw new DomainError(error.code ?? "invalid_input",error.message ?? "이 작업은 적용되지 않았어요",false,error.fieldErrors,error.currentRevision) }
   if (old.state === "running" && old.lease_until > now) throw new DomainError("operation_pending", "작업이 진행 중이에요",true)
   await run(tx, "UPDATE mutation_operations SET state='running',attempt=attempt+1,fence=fence+1,lease_until=?,error_json=NULL,updated_at=? WHERE id=?", [now+120000, now, old.id])
   return {id:old.id,ownerId:actorId,fence:old.fence+1,leaseUntil:now+120000,attempt:old.attempt+1,startedAt:now,replay:false,resourceId:old.reserved_resource_id,phase:old.phase}
  }
  const id=ctx.id()
  await run(tx, "INSERT INTO mutation_operations(id,owner_id,kind,key,payload_hash,state,lease_until,created_at,updated_at) VALUES (?,?,?,?,?,'running',?,?,?)", [id, actorId, kind, op.key, hash, now+120000, now, now])
  return {id,ownerId:actorId,fence:1,leaseUntil:now+120000,attempt:1,startedAt:now,replay:false,resourceId:null,phase:null}
 })
}
/** Verifies this execution still owns the operation, and keeps the row locked until the transaction ends so nobody can reclaim it in between. */
export async function assertOperation(tx: Db, ctx: ServiceContext, claim: OperationClaim): Promise<void> {
 const row = await one<StoredOperation>(tx, "SELECT fence,lease_until,state FROM mutation_operations WHERE id=? AND owner_id=? FOR UPDATE", [claim.id, claim.ownerId])
 if (!row || row.state!=="running" || row.fence!==claim.fence || row.lease_until<=ctx.clock.now()) throw new DomainError("operation_lease_lost","이전 실행은 더 이상 저장할 수 없어요",true)
}
export async function commitOperation(tx: Db, ctx: ServiceContext, claim: OperationClaim, result: unknown): Promise<void> {
 await assertOperation(tx, ctx, claim)
 await run(tx, "UPDATE mutation_operations SET state='succeeded',result_json=?,error_json=NULL,updated_at=? WHERE id=? AND fence=?", [JSON.stringify(result), ctx.clock.now(), claim.id, claim.fence])
}
/** Runs `mutate` and records the operation's result in ONE transaction. External I/O belongs before this call, never inside `mutate`. */
export async function finishOperation<T>(ctx: ServiceContext, claim: OperationClaim, mutate: (tx: Db) => Promise<T> | T): Promise<T> {
 return ctx.db.transaction(async (tx) => {
  await assertOperation(tx, ctx, claim)
  const result = await mutate(tx)
  await commitOperation(tx, ctx, claim, result)
  return result
 })
}
export async function failOperation(ctx: ServiceContext, claim: OperationClaim, error: unknown): Promise<void> {
 const domain = error instanceof DomainError ? error : new DomainError("internal_error","작업을 마치지 못했어요. 상태를 확인하고 다시 시도해 주세요",true)
 await run(ctx.db, "UPDATE mutation_operations SET state=?,error_json=?,updated_at=? WHERE id=? AND fence=? AND state='running'", [domain.retryable?"failed_retryable":"failed_final", JSON.stringify({code:domain.code,message:domain.message,fieldErrors:domain.fieldErrors,currentRevision:domain.currentRevision}), ctx.clock.now(), claim.id, claim.fence])
}
export async function runOperation<T>(ctx: ServiceContext, actorId: string, kind: string, input: unknown, op: OperationMeta, mutate: (tx: Db, claim: OperationClaim) => Promise<T> | T): Promise<T> {
 const claim = await beginOperation(ctx, actorId, kind, input, op)
 if (claim.replay) return claim.result as T
 try { return await finishOperation(ctx, claim, tx => mutate(tx, claim)) } catch (error) { await failOperation(ctx, claim, error); throw error }
}
export async function readOperation(ctx: ServiceContext, actorId: string, lookup: {id:string} | {kind:string;key:string}): Promise<OperationView & {result?:unknown}> {
 const row = "id" in lookup
  ? await one<StoredOperation>(ctx.db, "SELECT * FROM mutation_operations WHERE owner_id=? AND id=?", [actorId, lookup.id])
  : await one<StoredOperation>(ctx.db, "SELECT * FROM mutation_operations WHERE owner_id=? AND kind=? AND key=?", [actorId, lookup.kind, lookup.key])
 if(!row) throw new DomainError("not_found","작업을 찾을 수 없어요")
 return {id:row.id,kind:row.kind,state:row.state==="running" && row.lease_until<=ctx.clock.now()?"interrupted":row.state,attempt:row.attempt,resourceId:row.reserved_resource_id,errorCode:row.error_json?JSON.parse(row.error_json).code:null,...(row.state==="succeeded"?{result:JSON.parse(row.result_json ?? "null")}: {})}
}

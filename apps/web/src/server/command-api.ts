import { ZodError, type ZodType } from "zod"
import { DomainError, type OperationMeta } from "@/contracts/common"
import { operationMetaSchema } from "@/contracts/operations"
import { logEvent } from "./log"
export function jsonResult<T>(data:T,status=200):Response {
 return Response.json({ok:true,data,meta:{}},{status,headers:{"Cache-Control":"private, no-store"}})
}
export function operationKey(request:Request):OperationMeta { return operationMetaSchema.parse({key:request.headers.get("Idempotency-Key")}) }
export async function commandBody<T>(request:Request,schema:ZodType<T>):Promise<T> {
 let value:unknown;try{value=await request.json()}catch{throw new DomainError("invalid_input","JSON 입력을 확인해 주세요")}
 return schema.parse(value)
}
export async function handleCommand(fn:()=>Promise<Response>|Response):Promise<Response> {
 try{return await fn()}catch(error){
  let domain:DomainError
  if(error instanceof DomainError)domain=error
  else if(error instanceof ZodError){const fields:Record<string,string[]>=Object.create(null);for(const issue of error.issues)(fields[issue.path.join(".")]??=[]).push(issue.message);domain=new DomainError("invalid_input","입력한 내용을 확인해 주세요",false,fields)}
  else {logEvent("api.rejected",{code:"internal_error"});domain=new DomainError("internal_error","작업 상태를 확인한 뒤 다시 시도해 주세요",true)}
  const status=domain.code==="operation_pending"?202:domain.code==="unauthenticated"?401:domain.code==="forbidden"||domain.code==="csrf_failed"?403:domain.code==="not_found"?404:domain.code==="invalid_input"||domain.code==="unsupported_condition"||domain.code==="preference_conflict"?422:domain.code==="internal_error"?500:domain.code==="operation_timeout"?504:domain.code.startsWith("calendar_fetch")?502:409
  return Response.json({ok:false,error:{code:domain.code,message:domain.message,retryable:domain.retryable,fieldErrors:domain.fieldErrors,currentRevision:domain.currentRevision},meta:{outcome:domain.code==="internal_error"?"unknown":domain.code==="operation_pending"?"pending":"not_applied"}},{status,headers:{"Cache-Control":"private, no-store"}})
 }
}

import { onboardingTurnSchema } from '@/contracts/profile'
import { requireActor } from '@/server/session'
import { db, llm } from '@/server/context'
import { makeContext } from '@/server/runtime'
import { commandBody, handleCommand, jsonResult, operationKey } from '@/server/command-api'
import { onboardingTurn } from '@/server/services/onboarding'
export function POST(req:Request,{params}:{params:Promise<{id:string}>}) {return handleCommand(async()=>{
 const actor=await requireActor(req),{id}=await params
 return jsonResult(await onboardingTurn({...makeContext(db()),llm:llm()},actor.id,{draftId:id,...await commandBody(req,onboardingTurnSchema)},operationKey(req)))
})}

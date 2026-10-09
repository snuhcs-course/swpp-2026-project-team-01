// AI-generated with Codex (gpt-6-astra), 2026-10-05
import {requireActor} from '@/server/session'
import {db,llm} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {commandBody,handleCommand,jsonResult,operationKey} from '@/server/command-api'
import {createSearchSchema} from '@/contracts/search'
import {createSearch} from '@/server/services/search'
export function POST(req:Request){return handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(await createSearch(makeContext(db()),actor.id,await commandBody(req,createSearchSchema),operationKey(req)))})}

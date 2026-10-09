// AI-generated with Codex (gpt-6-astra), 2026-10-05
import {DomainError} from '@/contracts/common'
import {handleCommand} from '@/server/command-api'
import {requireActor} from '@/server/session'
const retired=(req:Request)=>handleCommand(async()=>{await requireActor(req);throw new DomainError('invalid_input','예약 화면에서 새 탐색을 시작해 주세요')})
export const POST=retired
export const DELETE=retired

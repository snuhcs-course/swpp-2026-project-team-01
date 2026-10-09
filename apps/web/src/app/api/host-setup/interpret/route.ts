// AI-generated with Codex (gpt-6-astra), 2026-10-05; Claude Code (claude-opus-5-5), 2026-10-05, 2026-10-06
import { z } from 'zod'
import { textSchema } from '@/contracts/common'
import { requireActor } from '@/server/session'
import { db, llm } from '@/server/context'
import { commandBody, handleCommand, jsonResult } from '@/server/command-api'
import { listMeetingTypes, listPlaces } from '@/server/repos/hosting'
import { interpretHostSetup } from '@/llm/host-setup'
/** Reads places and meeting formats out of what the host says. Changes nothing: the host adds each proposal themselves. */
export function POST(req: Request) { return handleCommand(async () => {
 const actor = await requireActor(req), { text } = await commandBody(req, z.strictObject({ text: textSchema }))
 const existing = { places: await listPlaces(db(), actor.id), meetingTypes: await listMeetingTypes(db(), actor.id) }
 return jsonResult(await interpretHostSetup(llm(), { text, existing }))
}) }

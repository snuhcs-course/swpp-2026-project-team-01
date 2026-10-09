// AI-generated with Codex (gpt-6-astra), 2026-10-05; Claude Code (claude-opus-5-5), 2026-10-05
import { z } from 'zod'
import { requireActor } from '@/server/session'
import { db } from '@/server/context'
import { makeContext } from '@/server/runtime'
import { commandBody, handleCommand, jsonResult } from '@/server/command-api'
import { acceptInvite } from '@/server/services/contacts'
/** Add the owner of a booking link as a contact (both ways). */
export function POST(req: Request) { return handleCommand(async () => {
 const actor = await requireActor(req), { token } = await commandBody(req, z.strictObject({ token: z.string().min(1).max(200) }))
 return jsonResult(await acceptInvite(makeContext(db()), actor.id, token))
}) }

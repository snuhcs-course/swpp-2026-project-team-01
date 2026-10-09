// AI-generated with Codex (gpt-6-astra), 2026-10-05; Claude Code (claude-opus-5-5), 2026-10-05
import { requireActor } from '@/server/session'
import { db } from '@/server/context'
import { handleCommand, jsonResult } from '@/server/command-api'
import { renewInviteToken } from '@/server/services/contacts'
/** Replace the booking link; the old one stops working. */
export function POST(req: Request) { return handleCommand(async () => {
 const actor = await requireActor(req)
 return jsonResult({ token: await renewInviteToken(db(), actor.id) })
}) }

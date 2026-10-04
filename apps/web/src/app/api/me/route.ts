import { requireActor } from '@/server/session'
import { handleAuth } from '@/server/services/auth'
import { jsonResult } from '@/server/command-api'
import { getDb, one } from '@/server/db/client'
import { profileReadiness } from '@/server/services/profile'
export function GET(req: Request) { return handleAuth(async () => {
 const actor = await requireActor(req), db = getDb()
 const row = (await one<{setup_state:string}>(db, 'SELECT setup_state FROM users WHERE id=?', [actor.id]))!
 return jsonResult({actor, setupState: row.setup_state, bookingReady: (await profileReadiness(db, actor.id)).ready})
}) }

import { z } from "zod"
import { body, handle } from "@/server/api"
import { BookingError } from "@/server/services/booking"
import { currentUser, db } from "@/server/context"
import { getRules, saveRules } from "@/server/repos/users"

const rule = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
})
const schema = z.object({ rules: z.array(rule).length(7) })

export function GET() {
  return handle(async () => Response.json({ rules: await getRules(db(), (await currentUser()).id) }))
}

export function PUT(req: Request) {
  return handle(async () => {
    const { rules } = await body(req, schema)
    if (new Set(rules.map((r) => r.weekday)).size !== 7) throw new BookingError("invalid", "요일이 중복되었어요")
    if (rules.some((r) => r.enabled && r.startMin >= r.endMin)) throw new BookingError("invalid", "끝 시각이 시작 시각보다 늦어야 해요")
    await saveRules(db(), (await currentUser()).id, rules)
    return Response.json({ ok: true })
  })
}

import { z } from "zod"
import { MIN_MS, parseHm, parseKstDate } from "@/core/time"
import { body, handle } from "@/server/api"
import { BookingError } from "@/server/services/booking"
import { currentUser, db } from "@/server/context"
import { addEvent, listEvents } from "@/server/repos/events"

const schema = z.object({
  title: z.string().trim().min(1).max(100),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  kind: z.enum(["office", "place", "online", "none"]),
  placeRef: z.string().trim().max(100).nullable().optional(),
})

export function GET(req: Request) {
  return handle(async () => Response.json({ events: await listEvents(db(), (await currentUser(req)).id) }))
}

export function POST(req: Request) {
  return handle(async () => {
    const input = await body(req, schema)
    const day = parseKstDate(input.date)
    const s = parseHm(input.start)
    const e = parseHm(input.end)
    if (day === null || s === null || e === null || e <= s) throw new BookingError("invalid", "날짜와 시간을 확인해 주세요 (끝 시각이 시작보다 늦어야 해요)")
    const user = await currentUser(req)
    const id = await addEvent(db(), user.id, {
      title: input.title,
      startMs: day + s * MIN_MS,
      endMs: day + e * MIN_MS,
      kind: input.kind,
      placeRef: input.kind === "place" ? (input.placeRef || input.title) : null,
    })
    return Response.json({ id }, { status: 201 })
  })
}

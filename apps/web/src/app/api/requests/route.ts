import { z } from "zod"
import { body, handle } from "@/server/api"
import { currentUser, db, now } from "@/server/context"
import { createRequest } from "@/server/services/booking"

const schema = z.object({
  hostId: z.string(),
  startMs: z.number().int(),
  placeId: z.string(),
  meetingTypeId: z.string(),
  message: z.string(),
})

export function POST(req: Request) {
  return handle(async () => {
    const input = await body(req, schema)
    const client = await currentUser()
    const row = await createRequest(db(), { ...input, clientId: client.id }, now())
    return Response.json({ id: row.id, status: row.status }, { status: 201 })
  })
}

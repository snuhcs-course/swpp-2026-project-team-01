import { z } from "zod"
import { body, handle } from "@/server/api"
import { currentUser, db } from "@/server/context"
import { addMeetingType, listMeetingTypes } from "@/server/repos/hosting"

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  durationMin: z.number().int().min(5).max(480),
})

export function GET(req: Request) {
  return handle(async () => Response.json({ meetingTypes: await listMeetingTypes(db(), (await currentUser(req)).id) }))
}

export function POST(req: Request) {
  return handle(async () => {
    const input = await body(req, schema)
    return Response.json({ meetingType: await addMeetingType(db(), (await currentUser(req)).id, input) }, { status: 201 })
  })
}

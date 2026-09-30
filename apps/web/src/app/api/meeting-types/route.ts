import { z } from "zod"
import { body, handle } from "@/server/api"
import { currentUser, db } from "@/server/context"
import { addMeetingType, listMeetingTypes } from "@/server/repos/hosting"

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  durationMin: z.number().int().min(5).max(480),
})

export function GET() {
  return handle(async () => Response.json({ meetingTypes: await listMeetingTypes(db(), (await currentUser()).id) }))
}

export function POST(req: Request) {
  return handle(async () => {
    const input = await body(req, schema)
    return Response.json({ meetingType: await addMeetingType(db(), (await currentUser()).id, input) }, { status: 201 })
  })
}

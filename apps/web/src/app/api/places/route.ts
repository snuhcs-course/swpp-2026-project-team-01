import { z } from "zod"
import { body, handle } from "@/server/api"
import { currentUser, db } from "@/server/context"
import { addPlace, listPlaces } from "@/server/repos/hosting"

const placeSchema = z.object({
  kind: z.enum(["office_near", "special", "online"]),
  name: z.string().trim().min(1).max(60),
})

export function GET() {
  return handle(async () => Response.json({ places: await listPlaces(db(), (await currentUser()).id) }))
}

export function POST(req: Request) {
  return handle(async () => {
    const input = await body(req, placeSchema)
    return Response.json({ place: await addPlace(db(), (await currentUser()).id, input) }, { status: 201 })
  })
}

import { z } from "zod"
import { body, handle } from "@/server/api"
import { currentUser, db } from "@/server/context"
import { addPlace, listPlaces } from "@/server/repos/hosting"

const placeSchema = z.object({
  kind: z.enum(["office_near", "special", "online"]),
  name: z.string().trim().min(1).max(60),
})

export function GET(req: Request) {
  return handle(async () => Response.json({ places: listPlaces(db(), (await currentUser(req)).id) }))
}

export function POST(req: Request) {
  return handle(async () => {
    const input = await body(req, placeSchema)
    return Response.json({ place: addPlace(db(), (await currentUser(req)).id, input) }, { status: 201 })
  })
}

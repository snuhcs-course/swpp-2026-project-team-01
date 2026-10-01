import { z } from "zod"
import { body, handle, fail } from "@/server/api"
import { USER_COOKIE, db } from "@/server/context"
import { getUser } from "@/server/repos/users"
import { cookies } from "next/headers"

export function POST(req: Request) {
  return handle(async () => {
    const { userId } = await body(req, z.object({ userId: z.string() }))
    if (!(await getUser(db(), userId))) return fail("not_found", "사용자를 찾을 수 없어요")
    ;(await cookies()).set(USER_COOKIE, userId, { path: "/", httpOnly: true, sameSite: "lax" })
    return Response.json({ ok: true })
  })
}

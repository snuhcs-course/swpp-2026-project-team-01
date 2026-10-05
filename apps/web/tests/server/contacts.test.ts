import { expect, it } from "vitest"
import { makeContext } from "@/server/runtime"
import { acceptInvite, canBook, contactIds, inviteToken, inviter, renewInviteToken, INVITE_TOKEN } from "@/server/services/contacts"
import { createSearch } from "@/server/services/search"
import { returnPathSchema } from "@/contracts/auth"
import { NOW, U, freshDb } from "./helpers"

const real = (db: Awaited<ReturnType<typeof freshDb>>["db"]) => makeContext(db, { now: () => NOW }, { mode: "real", allowReset: false })

it("gives each person one stable link and adds both people when it is opened", async () => {
  const { db } = await freshDb(), ctx = real(db)
  const token = await inviteToken(db, U.host)
  expect(token).toMatch(INVITE_TOKEN)
  expect(await inviteToken(db, U.host)).toBe(token)
  expect(await inviter(db, token)).toMatchObject({ id: U.host })
  expect(await acceptInvite(ctx, U.jiho, token)).toMatchObject({ hostId: U.host })
  await acceptInvite(ctx, U.jiho, token)                                  // opening it twice changes nothing
  expect([...await contactIds(db, U.jiho)]).toEqual([U.host])
  expect([...await contactIds(db, U.host)]).toEqual([U.jiho])
})

it("rejects your own link, unknown links and replaced links", async () => {
  const { db } = await freshDb(), ctx = real(db)
  const token = await inviteToken(db, U.host)
  await expect(acceptInvite(ctx, U.host, token)).rejects.toMatchObject({ code: "invalid_input" })
  await expect(acceptInvite(ctx, U.jiho, "x".repeat(24))).rejects.toMatchObject({ code: "not_found" })
  await expect(acceptInvite(ctx, U.jiho, "../../etc")).rejects.toMatchObject({ code: "not_found" })
  const renewed = await renewInviteToken(db, U.host)
  await expect(acceptInvite(ctx, U.jiho, token)).rejects.toMatchObject({ code: "not_found" })
  expect(await acceptInvite(ctx, U.jiho, renewed)).toMatchObject({ hostId: U.host })
})

it("lets real accounts book only their contacts; the demo keeps everyone bookable", async () => {
  const { db } = await freshDb(), ctx = real(db)
  expect(await canBook(ctx, U.jiho, U.host)).toBe(false)
  expect(await canBook(makeContext(db, { now: () => NOW }, { mode: "demo", allowReset: true }), U.jiho, U.host)).toBe(true)
  await expect(createSearch(ctx, U.jiho, { hostId: U.host }, { key: "stranger" })).rejects.toMatchObject({ code: "not_found" })
  await acceptInvite(ctx, U.jiho, await inviteToken(db, U.host))
  expect(await canBook(ctx, U.jiho, U.host)).toBe(true)
})

it("allows signing in from a booking link and coming back to it", () => {
  expect(returnPathSchema.safeParse("/invite/" + "a".repeat(24)).success).toBe(true)
  expect(returnPathSchema.safeParse("/invite/../../x").success).toBe(false)
  expect(returnPathSchema.safeParse("/invite/" + "a".repeat(25)).success).toBe(false)
})

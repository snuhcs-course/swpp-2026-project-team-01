import { expect, it } from "vitest"
import { bindDatabaseMode } from "@/server/db/client"
import { emptyDb } from "./helpers"

it("binds a database to one mode", async () => {
  const { db } = await emptyDb()
  await bindDatabaseMode(db, "real")
  await expect(bindDatabaseMode(db, "demo")).rejects.toThrow(/mode/)
  await bindDatabaseMode(db, "real")
})
it("refuses to treat existing demo accounts as a real database", async () => {
  const { db, sqlite } = await emptyDb()
  await sqlite.exec("INSERT INTO users(id,name) VALUES ('seed','Demo')")
  await expect(bindDatabaseMode(db, "real")).rejects.toThrow(/separate/)
})
it("refuses to treat real identities as a demo database", async () => {
  const { db, sqlite } = await emptyDb()
  await sqlite.exec("INSERT INTO users(id,name) VALUES ('u','User'); INSERT INTO auth_identities(id,user_id,provider,subject) VALUES ('i','u','google','s')")
  await expect(bindDatabaseMode(db, "demo")).rejects.toThrow(/real identities/)
})

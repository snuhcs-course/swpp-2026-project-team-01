// AI-generated with Codex (gpt-6-astra), 2026-10-05; Claude Code (claude-sonnet-5-5), 2026-10-05
import { afterEach, describe, expect, it } from "vitest"
import { makeContext } from "@/server/runtime"
import { run } from "@/server/db/client"
import { beginOperation, commitOperation, readOperation, runOperation } from "@/server/services/operations"
import { emptyDb } from "./helpers"

async function setup() {
  const connection = await emptyDb()
  await connection.sqlite.exec("INSERT INTO users(id,name) VALUES ('u','User'),('other','Other')")
  let time = 1000
  const ctx = makeContext(connection.db, { now: () => time })
  return { ...connection, ctx, advance: (ms: number) => { time += ms } }
}
describe("mutation operations", () => {
  it("replays commit after lost response without another mutation", async () => {
    const { ctx, sqlite } = await setup()
    const execute = () => runOperation(ctx, "u", "increment", { a: 1 }, { key: "test" }, async tx => {
      await run(tx, "UPDATE users SET revision=revision+1 WHERE id='u'")
      return { resourceId: "u", revision: 1 }
    })
    expect(await execute()).toEqual(await execute())
    expect(await sqlite.prepare("SELECT revision FROM users WHERE id='u'").get()).toEqual({ revision: 1 })
    await expect(runOperation(ctx, "u", "increment", { a: 2 }, { key: "test" }, () => ({}))).rejects.toMatchObject({ code: "idempotency_key_reused" })
  })
  it("expired fence cannot commit after takeover", async () => {
    const { ctx, advance } = await setup()
    const first = await beginOperation(ctx, "u", "edit", {}, { key: "k" })
    advance(120001)
    const next = await beginOperation(ctx, "u", "edit", {}, { key: "k" })
    await expect(ctx.db.transaction(tx => commitOperation(tx, ctx, first, { resourceId: "u" }))).rejects.toThrowError(/실행/)
    await ctx.db.transaction(tx => commitOperation(tx, ctx, next, { resourceId: "u" }))
    expect((await readOperation(ctx, "u", { id: first.id })).state).toBe("succeeded")
    await expect(readOperation(ctx, "other", { id: first.id })).rejects.toThrowError(/찾/)
  })
  it("rolls back domain effects and records definitive failure", async () => {
    const { ctx, sqlite } = await setup()
    await expect(runOperation(ctx, "u", "edit", {}, { key: "fail" }, async tx => {
      await run(tx, "UPDATE users SET revision=10 WHERE id='u'")
      throw new Error("secret provider payload")
    })).rejects.toThrow()
    expect(await sqlite.prepare("SELECT revision FROM users WHERE id='u'").get()).toEqual({ revision: 0 })
    const state = await readOperation(ctx, "u", { kind: "edit", key: "fail" })
    expect(JSON.stringify(state)).not.toContain("secret")
    expect(state.state).toBe("failed_retryable")
  })
})

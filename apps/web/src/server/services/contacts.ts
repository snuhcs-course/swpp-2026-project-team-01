// AI-generated with Claude Code (claude-opus-5-5), 2026-10-05
import { randomBytes } from "node:crypto"
import { DomainError } from "@/contracts/common"
import type { ServiceContext } from "../runtime"
import { all, lock, one, run, type Db } from "../db/client"

/** The secret in a booking link is long and random, so a link can only be passed on, never guessed. */
const newToken = () => randomBytes(18).toString("base64url")
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{24}$/

/** The person's booking link token, created on first use. */
export async function inviteToken(db: Db, userId: string): Promise<string> {
  await run(db, "UPDATE users SET invite_token=? WHERE id=? AND invite_token IS NULL", [newToken(), userId])
  return (await one<{ invite_token: string }>(db, "SELECT invite_token FROM users WHERE id=?", [userId]))!.invite_token
}

/** A new link replaces the old one; people already added stay contacts. */
export async function renewInviteToken(db: Db, userId: string): Promise<string> {
  const token = newToken()
  await run(db, "UPDATE users SET invite_token=? WHERE id=?", [token, userId])
  return token
}

export async function inviter(db: Db, token: string): Promise<{ id: string; name: string } | undefined> {
  if (!INVITE_TOKEN.test(token)) return undefined
  return one<{ id: string; name: string }>(db, "SELECT id,name FROM users WHERE invite_token=?", [token])
}

/** Opening someone's link makes the two people contacts of each other. */
export async function acceptInvite(ctx: ServiceContext, userId: string, token: string): Promise<{ hostId: string; hostName: string }> {
  const host = await inviter(ctx.db, token)
  if (!host) throw new DomainError("not_found", "예약 링크가 올바르지 않거나 새 링크로 바뀌었어요")
  if (host.id === userId) throw new DomainError("invalid_input", "내 예약 링크예요. 다른 사람에게 보내 주세요")
  await ctx.db.transaction(async (tx) => {
    await lock(tx, `contacts:${[userId, host.id].sort().join(":")}`)
    const now = ctx.clock.now()
    await run(tx, "INSERT INTO contacts(owner_id,contact_id,created_at) VALUES (?,?,?),(?,?,?) ON CONFLICT DO NOTHING", [userId, host.id, now, host.id, userId, now])
  })
  return { hostId: host.id, hostName: host.name }
}

export async function contactIds(db: Db, userId: string): Promise<Set<string>> {
  return new Set((await all<{ contact_id: string }>(db, "SELECT contact_id FROM contacts WHERE owner_id=?", [userId])).map((r) => r.contact_id))
}

/** People book only those they are connected with, in the demo as well (its seed connects some accounts in advance). */
export async function canBook(ctx: Pick<ServiceContext, "db">, clientId: string, hostId: string): Promise<boolean> {
  return !!(await one(ctx.db, "SELECT 1 FROM contacts WHERE owner_id=? AND contact_id=?", [clientId, hostId]))
}

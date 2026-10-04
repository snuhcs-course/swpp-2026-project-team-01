import { randomUUID } from "node:crypto"
import { and, asc, eq } from "drizzle-orm"
import type { Filter } from "@/core/types"
import type { Db } from "../db/client"
import { schema } from "../db/client"

export interface OptionView {
  startMs: number
  placeId: string
  meetingTypeId: string
  label: string
}

export interface MessageView {
  id: string
  role: "user" | "assistant"
  content: string
  options: OptionView[] | null
  createdAt: string
}

export interface ConversationRow {
  id: string
  clientId: string
  hostId: string
  filter: Filter
}

const toRow = (r: typeof schema.conversations.$inferSelect): ConversationRow => ({
  id: r.id,
  clientId: r.clientId,
  hostId: r.hostId,
  filter: Object.fromEntries(Object.entries(JSON.parse(r.filterJson) as Record<string, { state: string; value?: unknown }>).filter(([, entry]) => entry.state === "override").map(([key, entry]) => [key, entry.value])) as Filter,
})

export async function getConversation(db: Db, id: string): Promise<ConversationRow | undefined> {
  const [r] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id))
  return r && toRow(r)
}

export async function getOrCreateConversation(db: Db, clientId: string, hostId: string): Promise<ConversationRow> {
  const [found] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.clientId, clientId), eq(schema.conversations.hostId, hostId)))
  if (found) return toRow(found)
  const row = { id: randomUUID(), clientId, hostId, filterJson: "{}" }
  await db.insert(schema.conversations).values(row)
  return toRow(row)
}

export async function saveFilter(db: Db, id: string, filter: Filter): Promise<void> {
  await db.update(schema.conversations)
    .set({ filterJson: JSON.stringify(Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, { state: "override", value }]))) })
    .where(eq(schema.conversations.id, id))
}

export async function listMessages(db: Db, conversationId: string): Promise<MessageView[]> {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
  return rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      options: m.optionsJson ? (JSON.parse(m.optionsJson) as OptionView[]) : null,
      createdAt: m.createdAt,
    }))
}

let lastStamp = 0
/** Strictly increasing ISO timestamps, so messages created in the same millisecond keep their order. */
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return new Date(lastStamp).toISOString()
}

export async function addMessage(db: Db, conversationId: string, role: "user" | "assistant", content: string, options: OptionView[] | null): Promise<MessageView> {
  const row = { id: randomUUID(), conversationId, role, content, optionsJson: options ? JSON.stringify(options) : null, createdAt: stamp() }
  await db.insert(schema.messages).values(row)
  return { id: row.id, role, content, options, createdAt: row.createdAt }
}

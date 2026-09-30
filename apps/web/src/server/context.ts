import { cookies } from "next/headers"
import { ollamaConfigFromEnv, OllamaClient } from "@/llm/ollama"
import { getDb, type Db } from "./db/client"
import { listUsers, type UserRow } from "./repos/users"

export const USER_COOKIE = "uid"

export function db(): Db {
  return getDb()
}

/** The user chosen in the header switcher; falls back to the first seeded user. */
export async function currentUser(): Promise<UserRow> {
  // Read cookies first: it makes the route dynamic, so `next build` never queries the database.
  const id = (await cookies()).get(USER_COOKIE)?.value
  const users = await listUsers(getDb())
  if (users.length === 0) throw new Error("No users. Run `npm run db:reset`.")
  return users.find((u) => u.id === id) ?? users[0]
}

const g = globalThis as unknown as { __mvpLlm?: OllamaClient }

export function llm(): OllamaClient {
  if (!g.__mvpLlm) g.__mvpLlm = new OllamaClient(ollamaConfigFromEnv())
  return g.__mvpLlm
}

export const now = () => Date.now()

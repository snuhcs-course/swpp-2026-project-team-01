import {redirect} from "next/navigation"
import {DomainError} from "@/contracts/common"
import { requireActor } from "./session"
import { ollamaConfigFromEnv, OllamaClient } from "@/llm/ollama"
import { getDb, type Db } from "./db/client"
import { getUser, type UserRow } from "./repos/users"

export const USER_COOKIE = "uid"

export function db(): Db {
  return getDb()
}

/** Verified session in real mode; demo switching is explicitly isolated. */
export async function currentUser(request?: Request): Promise<UserRow> {
  const actor = await requireActor(request).catch(e=>{if(!request&&e instanceof DomainError&&e.code==="unauthenticated")redirect("/login");throw e})
  return (await getUser(getDb(), actor.id))!
}

const g = globalThis as unknown as { __mvpLlm?: OllamaClient }

export function llm(): OllamaClient {
  if (!g.__mvpLlm) g.__mvpLlm = new OllamaClient(ollamaConfigFromEnv())
  return g.__mvpLlm
}

export const now = () => Date.now()

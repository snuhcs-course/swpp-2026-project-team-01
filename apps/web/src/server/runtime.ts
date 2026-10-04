import { randomUUID } from "node:crypto"
import type { Db } from "./db/client"
import { readServerConfig, type ServerConfig } from "./config"
import type { ChatClient } from "@/llm/ollama"
export interface ServiceContext {
  db: Db; clock: { now(): number }; id(): string; config: ServerConfig; llm?: ChatClient;
}
export function makeContext(db: Db, clock = { now: () => Date.now() }, config = readServerConfig()): ServiceContext {
  return { db, clock, config, id: randomUUID }
}

import { sql, type SQL } from "drizzle-orm"
import type { Db } from "./client"

/**
 * Small raw-SQL helpers over a Drizzle Postgres database or transaction (postgres-js in the app, PGlite in tests).
 * Statements use `?` placeholders, which are bound as real parameters; a literal `?` therefore must not appear inside a statement.
 */
export type Row = Record<string, unknown>

export function bind(text: string, params: readonly unknown[] = []): SQL {
  const parts = text.split("?")
  if (parts.length - 1 !== params.length) throw new Error(`SQL expects ${parts.length - 1} parameters but got ${params.length}`)
  const chunks: SQL[] = []
  parts.forEach((part, i) => {
    if (part) chunks.push(sql.raw(part))
    if (i < params.length) chunks.push(sql`${params[i]}`)
  })
  return sql.join(chunks)
}

const rowsOf = (result: unknown): Row[] => (Array.isArray(result) ? (result as Row[]) : ((result as { rows?: Row[] }).rows ?? []))

export async function all<T = Row>(db: Db, text: string, params: readonly unknown[] = []): Promise<T[]> {
  return rowsOf(await db.execute(bind(text, params))) as T[]
}
export async function one<T = Row>(db: Db, text: string, params: readonly unknown[] = []): Promise<T | undefined> {
  return (await all<T>(db, text, params))[0]
}
/** Runs a statement and returns how many rows it changed. */
export async function run(db: Db, text: string, params: readonly unknown[] = []): Promise<number> {
  const result = (await db.execute(bind(text, params))) as { count?: number; affectedRows?: number }
  return Number(result.count ?? result.affectedRows ?? 0)
}
/** Serializes work on a named resource until the surrounding transaction ends (replaces SQLite's single-writer lock). */
export async function lock(db: Db, ...keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}
/** Multi-row INSERT in chunks (one network round trip per chunk instead of per row). `columns` are trusted constants, never user input. */
export async function insertMany(db: Db, table: string, columns: readonly string[], rows: readonly (readonly unknown[])[], chunk = 200): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk)
    const one = `(${columns.map(() => "?").join(",")})`
    await run(db, `INSERT INTO ${table}(${columns.join(",")}) VALUES ${part.map(() => one).join(",")}`, part.flat())
  }
}

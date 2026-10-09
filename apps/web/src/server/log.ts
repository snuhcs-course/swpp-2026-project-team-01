// AI-generated with Claude Code (claude-sonnet-5-5), 2026-09-30
/** One JSON object per line on stdout. Silent under test or with LOG_LEVEL=silent. Never pass message text or keys. */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV === "test" || process.env.LOG_LEVEL === "silent") return
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

export const roundMs = (ms: number): number => Math.round(ms)

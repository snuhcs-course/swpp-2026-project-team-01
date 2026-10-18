import { loadEnvConfig } from "@next/env"
import { createDb, ensureBound } from "@/server/db/client"
import { readServerConfig } from "@/server/config"
import { makeContext } from "@/server/runtime"
import { processInboundBatch, processOutboundOne } from "@/server/services/imessage"
import { createSpectrumTransport } from "@/server/providers/spectrum-imessage"
import { logEvent } from "@/server/log"

loadEnvConfig(process.cwd())
const config = readServerConfig()
if (config.mode !== "real") throw new Error("iMessage worker requires APP_MODE=real")
if (!config.databaseUrl || !config.spectrumProjectId || !config.spectrumProjectSecret) {
  throw new Error("Set DATABASE_URL, SPECTRUM_PROJECT_ID, and SPECTRUM_PROJECT_SECRET before starting the iMessage worker")
}
if (!config.spectrumImessageChannelConfirmed) {
  throw new Error("Confirm with Photon that this project will not fall back to SMS/RCS, then set SPECTRUM_IMESSAGE_CHANNEL_CONFIRMED=true")
}

const { client, db } = createDb(config.databaseUrl)
await ensureBound(db, "real")
const ctx = makeContext(db, { now: () => Date.now() }, config)
const transport = await createSpectrumTransport(config.spectrumProjectId, config.spectrumProjectSecret)
let stopping = false
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true })

try {
  logEvent("imessage.worker_started", {})
  while (!stopping) {
    let didWork = false
    try {
      didWork = (await processInboundBatch(db, Date.now())) > 0 || didWork
      didWork = (await processOutboundOne(ctx, transport)) || didWork
    } catch {
      logEvent("imessage.worker_iteration_failed", {})
    }
    if (!didWork && !stopping) await new Promise((resolve) => setTimeout(resolve, 1500))
  }
} finally {
  await transport.close?.()
  await client.end({ timeout: 5 })
  logEvent("imessage.worker_stopped", {})
}

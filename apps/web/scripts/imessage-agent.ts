import { Spectrum } from "spectrum-ts"
import { imessage } from "spectrum-ts/providers/imessage"

async function main() {
  const projectId = process.env.SPECTRUM_PROJECT_ID
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET

  if (!projectId || !projectSecret) {
    console.error("[photon] Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in .env.local.")
    process.exitCode = 1
    return
  }

  let app
  try {
    app = await Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()],
      options: { logLevel: "warn" },
    })
  } catch {
    console.error("[photon] Could not connect to Spectrum. Check the project credentials and network connection.")
    process.exitCode = 1
    return
  }

  let stopping = false
  let stopPromise: Promise<void> | undefined

  const stop = (signal: string) => {
    if (stopPromise) return stopPromise

    stopping = true
    console.info(`[photon] ${signal}; stopping the iMessage agent.`)
    stopPromise = app.stop().catch(() => {
      console.error("[photon] Failed to stop the Spectrum connection cleanly.")
      process.exitCode = 1
    })
    return stopPromise
  }

  process.once("SIGINT", () => void stop("SIGINT"))
  process.once("SIGTERM", () => void stop("SIGTERM"))

  console.info("[photon] Connected to Spectrum; waiting for iMessage.")

  try {
    for await (const [space, message] of app.messages) {
      if (stopping) break
      if (message.content.type !== "text") continue
      const inboundText = message.content.text

      try {
        await space.responding(async () => {
          await message.reply(`Photon Spectrum is connected. You said: ${inboundText}`)
        })
        console.info("[photon] Replied to an inbound text message.")
      } catch {
        console.error("[photon] Failed to reply to an inbound text message.")
      }
    }
  } catch {
    if (!stopping) {
      console.error("[photon] The Spectrum message stream ended unexpectedly.")
      process.exitCode = 1
    }
  } finally {
    if (!stopPromise) await stop("Message stream closed")
  }
}

void main().catch(() => {
  console.error("[photon] The iMessage agent stopped because of an unexpected error.")
  process.exitCode = 1
})

import { Spectrum } from "spectrum-ts"
import { imessage } from "spectrum-ts/providers/imessage"
import type { PhotonTransport } from "@/server/services/imessage"

export async function createSpectrumTransport(projectId: string, projectSecret: string): Promise<PhotonTransport> {
  const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] })
  const provider = imessage(app)
  return {
    async open(phone, requestedLine) {
      const user = await provider.user(phone)
      const space = await provider.space.create(user, requestedLine ? { phone: requestedLine } : {})
      // Spectrum's current user resolver may return only an id. Keep that unknown
      // signal visible to the service; deployments must verify the project’s
      // fallback policy with Photon before using this worker beyond test recipients.
      return { conversationId: space.id, lineId: space.phone, recipientService: user.service ?? "unknown" }
    },
    async send(_phone, conversationId, lineId, text) {
      const space = await provider.space.get(conversationId, { phone: lineId })
      const sent = await space.send(text)
      return { messageId: sent?.id }
    },
    async close() { await app.stop() },
  }
}

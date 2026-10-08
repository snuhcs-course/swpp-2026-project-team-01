// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import { cloud } from '@spectrum-ts/core';
import { createGrpcClient } from '@photon-ai/advanced-imessage/grpc';

export async function createPhotonProvider({ projectId, projectSecret, timeoutMs, onHeartbeat }) {
  const discovered = await cloud.issueImessageTokens(projectId, projectSecret);
  if (discovered.type !== 'shared' || typeof discovered.token !== 'string') {
    throw new Error('unsupported_photon_route');
  }

  const client = createGrpcClient({
    address: 'imessage.spectrum.photon.codes:443',
    token: discovered.token,
    tls: true,
    retry: false,
    autoIdempotency: false,
    timeout: timeoutMs,
    onHeartbeat,
    channelOptions: { 'grpc.enable_retries': 0 },
  });

  return Object.freeze({
    catchUp: (sequence) => client.events.catchUp(sequence),
    subscribe: () => client.messages.subscribeEvents(),
    getChat: (chatGuid) => client.chats.get(chatGuid),
    sendText: (chatGuid, text, clientMessageId) =>
      client.messages.sendText(chatGuid, text, { clientMessageId }),
    listOutbound: (chatGuid, after) =>
      client.messages.listInChat(chatGuid, { after, isFromMe: true, pageSize: 20 }),
    close: () => client.close?.(),
  });
}

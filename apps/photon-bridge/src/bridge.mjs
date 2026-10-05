const MAX_TEXT = 4_000;
const MAX_ID = 500;

const text = (value, maximum = MAX_ID) =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;

const safeError = (error) => ({
  code: /^[a-zA-Z0-9_]{1,100}$/u.test(error?.code ?? '') ? error.code : 'provider_error',
  retryable: error?.retryable === true,
});

export function normalizeInbound(event, chat) {
  if (event?.type !== 'message.received' || !Number.isSafeInteger(event.sequence) || event.sequence < 0) {
    return { accepted: false, disposition: 'invalid_event', sequence: null };
  }
  const message = event.message;
  const chatGuid = text(event.chatGuid);
  const providerMessageId = text(message?.guid);
  const sender = text(message?.sender?.address);
  const body = text(message?.content?.text, MAX_TEXT);
  const createdAt = message?.dateCreated instanceof Date && Number.isFinite(message.dateCreated.getTime())
    ? message.dateCreated.toISOString()
    : null;
  if (!chatGuid || !providerMessageId || !sender || !body || !createdAt) {
    return { accepted: false, disposition: 'invalid_message', sequence: event.sequence };
  }
  if (
    message.isFromMe !== false ||
    message.sender.service !== 'iMessage' ||
    message.itemType !== 'normal' ||
    message.isForward === true ||
    message.chatGuids?.length !== 1 ||
    message.chatGuids[0] !== chatGuid
  ) {
    return { accepted: false, disposition: 'unsupported_message', sequence: event.sequence };
  }
  if (
    !chat || chat.guid !== chatGuid || chat.isGroup !== false || chat.service !== 'iMessage' ||
    chat.participants?.length !== 1 || chat.participants[0]?.address !== sender ||
    chat.participants[0]?.service !== 'iMessage'
  ) {
    return { accepted: false, disposition: 'group_or_identity_mismatch', sequence: event.sequence };
  }
  return {
    accepted: true,
    value: {
      sequence: event.sequence,
      providerMessageId,
      conversationId: chatGuid,
      sender,
      service: 'iMessage',
      body,
      createdAt,
    },
  };
}

function validClaim(claim) {
  return claim && text(claim.intentId) && text(claim.conversationId) &&
    text(claim.clientMessageId) && text(claim.body, MAX_TEXT) &&
    typeof claim.createdAt === 'string' && Number.isFinite(Date.parse(claim.createdAt)) &&
    ['dispatch', 'reconcile'].includes(claim.action);
}

export class PhotonBridge {
  #backend;
  #providerFactory;
  #provider;
  #stopping = false;
  #inboundTail = Promise.resolve();
  #lastHeartbeat = 0;
  #subscribed = false;
  #outboundTimer;
  #outboundPending = Promise.resolve();

  constructor({ backend, providerFactory }) {
    this.#backend = backend;
    this.#providerFactory = providerFactory;
  }

  get health() {
    return Object.freeze({
      live: !this.#stopping,
      ready: this.#subscribed,
      lastHeartbeatAt: this.#lastHeartbeat ? new Date(this.#lastHeartbeat).toISOString() : null,
    });
  }

  heartbeat = () => {
    this.#lastHeartbeat = Date.now();
  };

  async start() {
    await this.#provider?.close?.();
    this.#provider = undefined;
    this.#subscribed = false;
    this.#lastHeartbeat = 0;
    const provider = await this.#providerFactory(this.heartbeat);
    if (this.#stopping) { await provider.close?.(); return; }
    this.#provider = provider;
    const resume = await this.#backend.resume();
    const sequence = Number.isSafeInteger(resume?.lastSequence) ? resume.lastSequence : 0;
    this.#inboundTail = Promise.resolve();
    try {
      await this.#consume(this.#provider.catchUp(sequence), true);
      if (this.#stopping) return;
      this.heartbeat();
      this.#subscribed = true;
      await this.#consume(this.#provider.subscribe(), false);
    } finally {
      this.#subscribed = false;
    }
  }

  async #consume(stream, catchUp) {
    for await (const event of stream) {
      if (this.#stopping) break;
      if (catchUp && event?.type === 'catchup.complete') continue;
      if (!Number.isSafeInteger(event?.sequence) || event.sequence < 0) continue;
      if (event?.type !== 'message.received') {
        if (Number.isSafeInteger(event?.sequence)) {
          await this.#backend.checkpoint(event.sequence, 'ignored_event_type');
        }
        continue;
      }
      this.#inboundTail = this.#handleInbound(event);
      await this.#inboundTail;
    }
  }

  async #handleInbound(event) {
    let chat;
    try {
      if (typeof event.chatGuid !== 'string') {
        await this.#backend.checkpoint(event.sequence, 'invalid_event');
        return;
      }
      chat = await this.#provider.getChat(event.chatGuid);
    } catch {
      // No checkpoint: a transient lookup failure must replay after reconnect.
      throw Object.assign(new Error('chat_lookup_failed'), { code: 'chat_lookup_failed' });
    }
    const normalized = normalizeInbound(event, chat);
    if (!normalized.accepted) {
      await this.#backend.checkpoint(normalized.sequence ?? event.sequence, normalized.disposition);
      return;
    }
    const result = await this.#backend.inbound(normalized.value);
    const disposition = /^[a-z_]{1,80}$/u.test(result?.disposition ?? '')
      ? result.disposition : 'processed';
    await this.#backend.checkpoint(normalized.value.sequence, disposition);
  }

  startOutboundPolling(intervalMs) {
    const poll = async () => {
      if (this.#stopping) return;
      try {
        this.#outboundPending = this.pollOutboundOnce();
        await this.#outboundPending;
      } catch (error) {
        process.stderr.write(`${JSON.stringify({
          event: 'photon_outbound_poll_failed',
          code: /^[a-zA-Z0-9_]{1,100}$/u.test(error?.code ?? '') ? error.code : 'poll_error',
        })}\n`);
      } finally {
        if (!this.#stopping) this.#outboundTimer = setTimeout(poll, intervalMs);
      }
    };
    this.#outboundTimer = setTimeout(poll, 0);
  }

  async pollOutboundOnce() {
    if (!this.#provider) return;
    const claim = await this.#backend.claimOutbound();
    if (!claim || claim.action === 'none') return;
    if (!validClaim(claim)) throw new Error('invalid_outbound_claim');
    const authority = await this.#backend.authorizeOutbound(claim.intentId);
    if (
      authority?.authorized !== true ||
      authority.conversationId !== claim.conversationId ||
      authority.clientMessageId !== claim.clientMessageId
    ) {
      await this.#backend.recordOutcome({ intentId: claim.intentId, status: 'revoked' });
      return;
    }
    if (claim.action === 'reconcile') {
      await this.#reconcile(claim);
      return;
    }
    let validatedProviderMessageId;
    try {
      const sent = await this.#provider.sendText(
        claim.conversationId,
        claim.body,
        claim.clientMessageId,
      );
      if (
        !text(sent?.guid) || sent.isFromMe !== true ||
        sent.chatGuids?.length !== 1 || sent.chatGuids[0] !== claim.conversationId ||
        sent.content?.text !== claim.body
      ) throw new Error('provider_response_mismatch');
      validatedProviderMessageId = sent.guid;
      await this.#backend.recordOutcome({
        intentId: claim.intentId,
        status: sent.isDelivered ? 'delivered' : 'accepted',
        providerMessageId: sent.guid,
        acceptedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.#backend.recordOutcome({
        intentId: claim.intentId,
        status: 'uncertain',
        ...(validatedProviderMessageId ? { providerMessageId: validatedProviderMessageId } : {}),
        error: safeError(error),
      });
    }
  }

  async #reconcile(claim) {
    try {
      const page = await this.#provider.listOutbound(
        claim.conversationId,
        new Date(claim.createdAt),
      );
      const matches = page.messages.filter((message) =>
        text(claim.providerMessageId) && message.guid === claim.providerMessageId &&
        message.isFromMe === true && message.content?.text === claim.body &&
        message.chatGuids?.length === 1 && message.chatGuids[0] === claim.conversationId &&
        message.dateCreated instanceof Date && Number.isFinite(message.dateCreated.getTime()),
      );
      if (matches.length !== 1 || page.nextPageToken) {
        await this.#backend.recordOutcome({
          intentId: claim.intentId,
          status: 'uncertain',
          error: { code: !text(claim.providerMessageId) ? 'unbound_provider_identity' :
            page.nextPageToken ? 'incomplete_history' : matches.length ? 'ambiguous_history' : 'not_observed', retryable: false },
        });
        return;
      }
      const message = matches[0];
      await this.#backend.recordOutcome({
        intentId: claim.intentId,
        status: message.isDelivered ? 'delivered' : 'accepted',
        providerMessageId: message.guid,
        acceptedAt: message.dateCreated.toISOString(),
      });
    } catch (error) {
      await this.#backend.recordOutcome({
        intentId: claim.intentId,
        status: 'uncertain',
        error: safeError(error),
      });
    }
  }

  async reconnect() {
    this.#subscribed = false;
    await this.#provider?.close?.();
  }

  async stop() {
    this.#stopping = true;
    this.#subscribed = false;
    clearTimeout(this.#outboundTimer);
    await this.#provider?.close?.();
    await Promise.allSettled([this.#inboundTail, this.#outboundPending]);
  }
}

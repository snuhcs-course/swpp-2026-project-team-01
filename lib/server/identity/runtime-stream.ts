import { ApplicationError, publicError } from '../errors.ts';
import { privateHeaders } from './request-credential.ts';

// Expose text/lifecycle only. Raw tool arguments/results, reasoning, auth,
// connections and runtime metadata never cross this browser boundary.
export function projectRuntimeEvent(value: unknown, cursor: number): Record<string, unknown> {
  const event = value as { type?: string; data?: Record<string, unknown>; meta?: { id?: string } };
  const data = event?.data ?? {};
  const base = { cursor, id: event?.meta?.id };
  const position = { turnId: data.turnId, stepIndex: data.stepIndex, sequence: data.sequence };
  if (event.type === 'message.received' && typeof data.message === 'string') return { ...base, type: 'user', ...position, text: data.message };
  if (event.type === 'message.appended' && typeof data.messageDelta === 'string') return { ...base, type: 'text', ...position, text: data.messageDelta };
  if (event.type === 'message.completed' && typeof data.message === 'string') return { ...base, type: 'message', ...position, text: data.message };
  if (['turn.started','step.started','turn.completed','turn.cancelled','session.waiting','session.completed'].includes(event.type ?? '')) {
    return { ...base, type: event.type, ...position };
  }
  if (['step.failed','turn.failed','session.failed'].includes(event.type ?? '')) return { ...base, type: 'failed', ...position, message: 'The response could not be completed. Your saved changes are preserved.' };
  return { cursor, type: 'cursor' };
}

export function authorizedStream(source: ReadableStream<unknown>, check: () => Promise<unknown>, startIndex: number,
  signal: AbortSignal, options: { pollMs?: number; leaseMs?: number } = {}): Response {
  const reader = source.getReader(); const encoder = new TextEncoder();
  let cursor = startIndex, stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined, lease: ReturnType<typeof setTimeout> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let checking: Promise<unknown> | undefined;
  const recheck = () => checking ??= check().finally(() => { checking = undefined; });
  function stop(error?: unknown) {
    if (stopped) return; stopped = true;
    clearInterval(interval); clearTimeout(lease); signal.removeEventListener('abort', abort);
    if (error) controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', ...publicError(error).body })+'\n'));
    controller.close(); void reader.cancel().catch(() => {});
  }
  function abort() { stop(); }
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      interval = setInterval(() => { void recheck().catch(stop); }, options.pollMs ?? 2000);
      lease = setTimeout(() => stop(), options.leaseMs ?? 45_000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) stop();
    },
    async pull() {
      try {
        const item = await reader.read();
        if (stopped) return;
        if (item.done) { stop(); return; }
        await recheck(); if (stopped) return;
        controller.enqueue(encoder.encode(JSON.stringify(projectRuntimeEvent(item.value, ++cursor))+'\n'));
      } catch (error) { stop(error instanceof ApplicationError ? error : new ApplicationError('PROVIDER_UNAVAILABLE', 503)); }
    },
    cancel() { stopped = true; clearInterval(interval); clearTimeout(lease); signal.removeEventListener('abort', abort); return reader.cancel(); },
  });
  return new Response(body, { headers: { ...privateHeaders, 'content-type': 'application/x-ndjson; charset=utf-8' } });
}

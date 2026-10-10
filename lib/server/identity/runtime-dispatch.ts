import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Database } from '../database/client.ts';
import { ApplicationError } from '../errors.ts';
import { Conversations } from './conversations.ts';
import type { RuntimeAuth } from './runtime-messages.ts';

export function requireDispatchSecret(request: Request, env = process.env) {
  const provided = request.headers.get('authorization') ?? '';
  if (!/^Bearer [a-f0-9]{64}$/u.test(provided)) throw new ApplicationError('UNAUTHORIZED', 401);
  const expected = env.RUNTIME_DISPATCH_SECRET;
  if (!expected || !/^[a-f0-9]{64}$/u.test(expected)) throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503);
  const hash = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(hash(provided), hash('Bearer '+expected))) throw new ApplicationError('UNAUTHORIZED', 401);
}
const delivery = z.object({ messageId: z.uuid(), conversationId: z.uuid(), grantId: z.uuid(),
  text: z.string(), leaseToken: z.uuid(), sessionId: z.string().nullable() });
export async function dispatchPending(
  send: (scope: string, text: string, auth: RuntimeAuth, sessionId: string | null) => Promise<void>,
  database = new Database(), conversations = new Conversations(database),
) {
  const claimed = z.array(delivery).parse(await database.rpc('fmat_runtime_dispatch', {p_operation:'claim',p_input:{}}));
  const results = await Promise.allSettled(claimed.map(async message => {
    let outcome: 'sent' | 'retry' | 'revoked' = 'sent';
    try {
      await conversations.checkExecution(message.grantId, message.conversationId);
      await send(message.conversationId, message.text, {
        authenticator:'fmat-conversation',principalType:'user',principalId:message.grantId,
        attributes:{conversationId:message.conversationId,messageId:message.messageId},
      },message.sessionId);
    } catch(error) {
      outcome = error instanceof ApplicationError && [401,403,404].includes(error.status) ? 'revoked' : 'retry';
    }
    await database.rpc('fmat_runtime_dispatch',{p_operation:'finish',p_input:{messageId:message.messageId,leaseToken:message.leaseToken,outcome}});
    return outcome;
  }));
  return { claimed: claimed.length, sent: results.filter(r=>r.status==='fulfilled'&&r.value==='sent').length };
}

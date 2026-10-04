// deno-lint-ignore no-import-prefix
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import type { Environment } from './env.ts';
import { databaseError, DomainError } from './errors.ts';
import { hashToken } from './security.ts';
export interface Actor {
  kind: 'host' | 'guest' | 'worker' | 'operator' | 'public';
  id?: string;
  email?: string;
  requestId?: string;
  tokenHash?: string;
  confirmationSource?: 'authenticated_web';
}
export interface Database {
  command<T = unknown>(operation: string, actor: Actor, input: Record<string, unknown>): Promise<T>;
  host(token: string): Promise<Actor>;
}
export function createDatabase(env: Environment): Database {
  const client = createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async command<T>(operation: string, actor: Actor, input: Record<string, unknown>): Promise<T> {
      const { data, error } = await client.rpc('fmat_command', {
        p_operation: operation,
        p_actor: actor,
        p_input: input,
      });
      if (error) throw databaseError(error.message);
      return data as T;
    },
    async host(token: string): Promise<Actor> {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user || !data.user.email_confirmed_at) {
        throw new DomainError('unauthorized', 401);
      }
      return { kind: 'host', id: data.user.id, email: data.user.email };
    },
  };
}
export async function actorFor(
  request: Request,
  database: Database,
  requestId?: string,
  hostOnly = false,
): Promise<Actor> {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return await database.host(authorization.slice(7));
  const token = request.headers.get('x-request-token');
  if (!hostOnly && requestId && token && token.length >= 32 && token.length <= 256) {
    return { kind: 'guest', requestId, tokenHash: await hashToken(token) };
  }
  throw new DomainError('unauthorized', 401);
}

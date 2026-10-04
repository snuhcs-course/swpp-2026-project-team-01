// deno-lint-ignore no-import-prefix
import { Hono } from 'npm:hono@4.13.13';
import type { Database } from '../_shared/database.ts';
import type { Environment } from '../_shared/env.ts';
import { onboardingRoutes } from './routes/onboarding.ts';
import { requestsRoutes } from './routes/requests.ts';
import { DomainError, errorResponse } from '../_shared/errors.ts';
export function createApi(env: Environment, database: Database) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && origin !== env.appOrigin) {
      return errorResponse(new DomainError('forbidden', 403), crypto.randomUUID());
    }
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Credentials', 'true');
    }
    c.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Idempotency-Key, X-Request-Token, apikey',
    );
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Cache-Control', 'no-store');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });
  app.onError((error) => errorResponse(error, crypto.randomUUID()));
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', onboardingRoutes(env, database));
  app.route('/', requestsRoutes(env, database));
  app.notFound(() => errorResponse(new DomainError('not_found', 404), crypto.randomUUID()));
  return app;
}

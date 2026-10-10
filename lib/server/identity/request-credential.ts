import { guestCredential, verifyHostToken, type Credential } from './credentials.ts';
import { ApplicationError, publicError } from '../errors.ts';
import { applicationOrigin } from '../config.ts';
import { requireSameOrigin } from './http.ts';

/** Header credentials only until the web session/cookie exchange is installed.
 * Cross-origin browser requests are rejected; callers never provide actor JSON. */
export async function requestCredential(request: Request): Promise<Credential> {
  if (request.headers.has('origin')) requireSameOrigin(request, applicationOrigin());
  else if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApplicationError('FORBIDDEN', 403);
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.startsWith('Bearer ') && !request.headers.has('x-request-id')) {
    return verifyHostToken(authorization.slice(7));
  }
  if (authorization.startsWith('Request ')) {
    return guestCredential(request.headers.get('x-request-id') ?? '', authorization.slice(8));
  }
  throw new ApplicationError('UNAUTHORIZED', 401);
}

export const privateHeaders = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  vary: 'Authorization, X-Request-Id',
};
export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApplicationError('INVALID_INPUT', 400);
  if (Number(request.headers.get('content-length')) > 48_000) throw new ApplicationError('INVALID_INPUT', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError('INVALID_INPUT', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 48_000) { await reader.cancel(); throw new ApplicationError('INVALID_INPUT', 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError('INVALID_INPUT', 400);
  } finally { reader.releaseLock(); }
}
export async function privateRoute(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    const safe = publicError(error);
    return Response.json(safe.body, { status: safe.status, headers: privateHeaders });
  }
}

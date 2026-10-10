import { ApplicationError } from '../errors.ts';

export function requireSameOrigin(request: Request, origin: string): void {
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApplicationError('FORBIDDEN', 403);
  }
}

export function safeReturnPath(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
      /[\\\r\n\u0000-\u001f]/u.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://return.invalid');
    // Only return to product workspaces, never protocol/action endpoints.
    if (url.origin !== 'https://return.invalid' ||
        !(url.pathname === '/app' || /^\/booking\/[a-zA-Z0-9-]+$/u.test(url.pathname))) return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}

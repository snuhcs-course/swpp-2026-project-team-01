import { ApplicationError } from './errors.ts';

export function requiredEnv(name: string, env = process.env): string {
  const value = env[name]?.trim();
  if (!value) throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503);
  return value;
}
export function applicationOrigin(env = process.env): string {
  let url: URL;
  try { url = new URL(requiredEnv('APP_ORIGIN', env)); }
  catch { throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503);
  }
  return url.origin;
}

/** Deployment metadata is server-owned. No request field can enable preview sends. */
export function requireMessagingEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const managed = ['VERCEL', 'VERCEL_ENV', 'VERCEL_TARGET_ENV', 'VERCEL_DEPLOYMENT_ID', 'VERCEL_URL']
    .some(name => env[name] !== undefined);
  if (managed && (env.VERCEL_ENV !== 'production' ||
      (env.VERCEL_TARGET_ENV !== undefined && env.VERCEL_TARGET_ENV !== 'production'))) {
    throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503);
  }
}

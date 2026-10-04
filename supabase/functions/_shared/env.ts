export interface Environment {
  supabaseUrl: string;
  serviceKey: string;
  appOrigin: string;
  workerSecret: string;
  googleClientId?: string;
  googleClientSecret?: string;
  encryptionKey?: string;
  openaiKey?: string;
  openaiModel: string;
  routesKey?: string;
  externalSends: boolean;
}
export function readEnvironment(get = (name: string) => Deno.env.get(name)): Environment {
  const required = (name: string, fallback?: string) => {
    const value = get(name) || (fallback && get(fallback));
    if (!value) throw new Error(`Configuration missing: ${name}`);
    return value;
  };
  const origin = new URL(required('APP_ORIGIN'));
  if (origin.pathname !== '/' || !['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('Invalid APP_ORIGIN');
  }
  const workerSecret = required('WORKER_SECRET');
  if (workerSecret.length < 32) {
    throw new Error('WORKER_SECRET must contain at least 32 characters');
  }
  return {
    supabaseUrl: required('SUPABASE_URL'),
    serviceKey: get('FMAT_SUPABASE_SECRET_KEY') ||
      required('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'),
    appOrigin: origin.origin,
    workerSecret,
    googleClientId: get('GOOGLE_CLIENT_ID'),
    googleClientSecret: get('GOOGLE_CLIENT_SECRET'),
    encryptionKey: get('TOKEN_ENCRYPTION_KEY'),
    openaiKey: get('OPENAI_API_KEY'),
    openaiModel: get('OPENAI_MODEL') || 'gpt-4o-mini-2024-07-18',
    routesKey: get('GOOGLE_ROUTES_API_KEY') || get('GOOGLE_MAPS_API_KEY'),
    externalSends: get('EXTERNAL_SENDS_ENABLED') === 'true',
  };
}

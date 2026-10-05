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
  transactionalEmails?: boolean;
  cloudflareAccountId?: string;
  cloudflareEmailToken?: string;
  cloudflareEmailFrom?: string;
  agentmailKey?: string;
  agentmailInboxId?: string;
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
  const serviceKey = get('FMAT_SUPABASE_SECRET_KEY') ||
    required('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
  if (serviceKey.startsWith('sb_publishable_')) {
    throw new Error('Privileged Supabase key is required');
  }
  return {
    supabaseUrl: required('SUPABASE_URL'),
    serviceKey,
    appOrigin: origin.origin,
    workerSecret,
    googleClientId: get('GOOGLE_CLIENT_ID'),
    googleClientSecret: get('GOOGLE_CLIENT_SECRET'),
    encryptionKey: get('TOKEN_ENCRYPTION_KEY'),
    openaiKey: get('OPENAI_API_KEY'),
    openaiModel: get('OPENAI_MODEL') || 'gpt-4o-mini-2024-07-18',
    routesKey: get('GOOGLE_ROUTES_API_KEY') || get('GOOGLE_MAPS_API_KEY'),
    externalSends: get('EXTERNAL_SENDS_ENABLED') === 'true',
    transactionalEmails: get('TRANSACTIONAL_EMAIL_ENABLED') === 'true',
    cloudflareAccountId: get('CLOUDFLARE_ACCOUNT_ID'),
    cloudflareEmailToken: get('CLOUDFLARE_EMAIL_API_TOKEN'),
    cloudflareEmailFrom: get('CLOUDFLARE_EMAIL_FROM'),
    agentmailKey: get('AGENTMAIL_API_KEY'),
    agentmailInboxId: get('AGENTMAIL_INBOX_ID'),
  };
}

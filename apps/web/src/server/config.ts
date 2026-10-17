// AI-generated with Codex (gpt-6-astra), 2026-10-05; Claude Code (claude-sonnet-5-5), 2026-10-05
export interface ServerConfig {
  mode: "demo" | "real"; databaseUrl?: string; allowReset: boolean;
  googleClientId?: string; googleClientSecret?: string; googleRedirectUri?: string;
  tokenEncryptionKey?: string; impactSigningKey?: string;
  spectrumProjectId?: string; spectrumProjectSecret?: string; spectrumWebhookId?: string; spectrumWebhookSecret?: string; spectrumImessageLine?: string;
  spectrumImessageChannelConfirmed?: boolean;
}
export function readServerConfig(env: Partial<NodeJS.ProcessEnv> = process.env): ServerConfig {
  const mode = env.APP_MODE ?? "demo"
  if (mode !== "demo" && mode !== "real") throw new Error("APP_MODE must be demo or real")
  // The database itself also remembers its mode (see bindDatabaseMode), so a real database can never be opened as a demo one or the reverse.
  if (mode === "real" && !env.DATABASE_URL) throw new Error("Real mode requires DATABASE_URL")
  return { mode, databaseUrl: env.DATABASE_URL, allowReset: mode === "demo", googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET, googleRedirectUri: env.GOOGLE_REDIRECT_URI,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY, impactSigningKey: env.IMPACT_SIGNING_KEY,
    spectrumProjectId: env.SPECTRUM_PROJECT_ID, spectrumProjectSecret: env.SPECTRUM_PROJECT_SECRET,
    spectrumWebhookId: env.SPECTRUM_WEBHOOK_ID, spectrumWebhookSecret: env.SPECTRUM_WEBHOOK_SECRET,
    spectrumImessageLine: env.SPECTRUM_IMESSAGE_LINE, spectrumImessageChannelConfirmed: env.SPECTRUM_IMESSAGE_CHANNEL_CONFIRMED === "true" }
}

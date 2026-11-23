import { generateKeyPairSync } from "node:crypto";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./token-key";

// The environment the browser tests give the web and agent services: the local
// Supabase stack plus local stand-ins for every outside provider. The browser QA
// stack (tests/qa/stack.ts) starts the same services with it on its own ports, so
// a hands-on pass sees what the browser tests see. No env file is read here.

export type LocalStack = { readonly API_URL: string; readonly DB_URL: string; readonly PUBLISHABLE_KEY: string };

export type StandInPorts = {
  readonly cloudflare: string;
  readonly google: string;
  readonly openai: string;
  readonly photon: string;
  readonly routes: string;
};

export const DEFAULT_STAND_IN_PORTS: StandInPorts = {
  cloudflare: "3104",
  google: "3103",
  openai: "3102",
  photon: "3106",
  routes: "3105",
};

// Refuses anything but the local stack, so a hosted project is never driven.
export function assertLocalStack(stack: LocalStack) {
  for (const value of [stack.API_URL, stack.DB_URL]) {
    const host = new URL(value).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`Only the local Supabase stack is allowed, not ${host}.`);
    }
  }
}

// The model: the local stand-in, or the real one with a key the caller found.
export function modelEnv(ports: StandInPorts, liveKey?: string): Record<string, string> {
  return liveKey
    ? { OPENAI_API_KEY: liveKey }
    : { OPENAI_API_KEY: "sk-test-not-a-real-key", OPENAI_BASE_URL: `http://127.0.0.1:${ports.openai}/v1` };
}

export function serviceEnv(stack: LocalStack, ports: StandInPorts): Record<string, string> {
  assertLocalStack(stack);

  return {
    DATABASE_URL: stack.DB_URL,
    EVE_INTERNAL_SIGNING_KEY: "e2e-internal-signing-key-for-the-local-stack-only",
    SUPABASE_PROJECT_REF: "local",
    SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: "",
    SUPABASE_URL: stack.API_URL,
    // Google's token endpoint and Calendar API, served by the local stand-in.
    GOOGLE_CALENDAR_API_URL: `http://127.0.0.1:${ports.google}/calendar/v3`,
    GOOGLE_CLIENT_ID: "e2e-google-client",
    GOOGLE_CLIENT_SECRET: "e2e-google-secret",
    GOOGLE_OAUTH_TOKEN_URL: `http://127.0.0.1:${ports.google}/token`,
    // The requester consent round trip, against the same stand-in.
    GOOGLE_REQUESTER_AUTH_URL: `http://127.0.0.1:${ports.google}/o/oauth2/v2/auth`,
    GOOGLE_REQUESTER_CLIENT_ID: "e2e-google-requester-client",
    GOOGLE_REQUESTER_CLIENT_SECRET: "e2e-google-requester-secret",
    GOOGLE_TOKEN_INFO_URL: `http://127.0.0.1:${ports.google}/tokeninfo`,
    // Google Routes and Cloudflare Email Sending, served by local stand-ins; the
    // messaging gate admits local sending only toward these loopback endpoints.
    CLOUDFLARE_ACCOUNT_ID: "e2e-account",
    CLOUDFLARE_EMAIL_API_TOKEN: "e2e-email-token",
    CLOUDFLARE_EMAIL_API_URL: `http://127.0.0.1:${ports.cloudflare}`,
    CLOUDFLARE_EMAIL_FROM: "no-reply@e2e.example.test",
    GOOGLE_MAPS_API_KEY: "fake-routes-key",
    GOOGLE_ROUTES_API_URL: `http://127.0.0.1:${ports.routes}`,
    // The iMessage line the Connect iMessage card shows, and the Photon stand-in
    // the outbox sends to; nothing reaches Photon.
    PHOTON_API_URL: `http://127.0.0.1:${ports.photon}`,
    // Integration runs share the local stack's outbox, so the line's daily
    // fallback cap is lifted here; its own tests run it at small values.
    PHOTON_FALLBACK_DAILY_LIMIT: "100000",
    PHOTON_LINE_NUMBER: "+15550001111",
    // The WhatsApp line (host-whatsapp-channel D1), as digits, so the card and the link step offer both.
    PHOTON_WHATSAPP_NUMBER: "15550002222",
    // WhatsApp is hidden unless offered (issue #221); the browser tests keep its screens covered.
    // WHATSAPP_OFFERED=0 runs them with WhatsApp hidden.
    WHATSAPP_OFFERED: process.env.WHATSAPP_OFFERED ?? "1",
    // The Telegram bot (host-telegram-channel D1), so the screens offer Telegram too; nothing reaches Telegram.
    TELEGRAM_BOT_USERNAME: "findmeatime_e2e_bot",
    // The product inbox Continue by email names; nothing reaches AgentMail.
    AGENTMAIL_INBOX_ID: "findmeatime@agentmail.test",
    // One key per run, shared with the tests so they can seal a Calendar grant.
    TOKEN_ENCRYPTION_KEY: E2E_TOKEN_ENCRYPTION_KEY,
    // A fresh Ed25519 key per run for agent access tokens.
    AGENT_TOKEN_SIGNING_KEY: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
export async function accountClient() {
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll() { return jar.getAll(); },
      setAll(values) {
        try { values.forEach(({name,value,options})=>jar.set(name,value,options)); }
        catch { /* Server Components are read-only; proxy refreshes cookies. */ }
      },
    },
  });
}
export const getAccount = cache(async () => {
  const jar = await cookies();
  if (!jar.getAll().some(c=>c.name.startsWith("sb-") && c.name.includes("-auth-token"))) return null;
  const client = await accountClient();
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
});
export function safeNext(value: unknown) {
  return typeof value === "string" && /^\/(?:owner|account)(?:\?[^\\]*)?$/.test(value) ? value
    : typeof value === "string" && /^\/request\/[A-Za-z0-9_-]{20,100}$/.test(value) ? value : "/owner";
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(process.env.APP_URL!).origin;
}

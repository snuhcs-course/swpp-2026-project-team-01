// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE } from "@/components/thyme/copy";
import { localeSchema, type Locale } from "@/contracts/profile";

/** The language the visitor picked on these screens; English until they pick one. */
export async function siteLocale(): Promise<Locale> {
  const parsed = localeSchema.safeParse((await cookies()).get(LOCALE_COOKIE)?.value);
  return parsed.success ? parsed.data : DEFAULT_LOCALE;
}

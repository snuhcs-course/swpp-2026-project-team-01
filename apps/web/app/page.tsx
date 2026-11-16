import { isMessagingChannel, whatsappOffered } from "@lib/contracts/messaging-channel";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { LOCALE_COOKIE, localeOf } from "@/app/_components/ink/copy";
import { Landing } from "@/app/_components/ink/landing";

// The public entry page: what the product is, the Google start (or, with `?flow=imessage`, `?flow=whatsapp` or
// `?flow=telegram`, the iMessage, WhatsApp or Telegram start: iMessage D15, WhatsApp D7, Telegram D7), the agent prompt, and where agents find the host instructions (also declared as the Markdown
// alternate). Its words follow the `lang` cookie.
export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/SKILL.md" } },
};

type SearchParams = Promise<{ flow?: string }>;

export default function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <Entry searchParams={searchParams} />
    </Suspense>
  );
}

async function Entry({ searchParams }: { readonly searchParams: SearchParams }) {
  const [{ flow }, jar] = await Promise.all([searchParams, cookies()]);
  // While WhatsApp is hidden (WHATSAPP_OFFERED, issue #221), an old /?flow=whatsapp link starts from Telegram.
  const channel = flow === "whatsapp" && !whatsappOffered(process.env) ? "telegram" : flow;
  return <Landing flow={isMessagingChannel(channel) ? channel : null} locale={localeOf(jar.get(LOCALE_COOKIE)?.value)} />;
}

import { isMessagingChannel } from "@lib/contracts/messaging-channel";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Landing } from "@/app/_components/ink/landing";

// The public entry page: what the product is, the Google start (or, with `?flow=imessage`, `?flow=whatsapp` or
// `?flow=telegram`, the iMessage, WhatsApp or Telegram start: iMessage D15, WhatsApp D7, Telegram D7), the agent prompt, and where agents find the host instructions (also declared as the Markdown
// alternate). Service UX writing is English-only.
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
  const { flow } = await searchParams;
  return <Landing flow={isMessagingChannel(flow) ? flow : null} locale="en" />;
}

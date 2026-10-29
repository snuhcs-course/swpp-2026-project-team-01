import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { LOCALE_COOKIE, localeOf } from "@/app/_components/ink/copy";
import { Landing } from "@/app/_components/ink/landing";

// The public entry page: what the product is, the Google start (or, with `?flow=imessage`, the iMessage start,
// D15), the agent prompt, and where agents find the host instructions (also declared as the Markdown
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
  return <Landing imessage={flow === "imessage"} locale={localeOf(jar.get(LOCALE_COOKIE)?.value)} />;
}
